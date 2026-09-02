import { Bot, webhookCallback, InlineKeyboard, Context } from "grammy";

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
}

// ----------------------------------------------------
// DATABASE & COMPUTATION HELPERS
// ----------------------------------------------------

async function getActiveProjects(db: D1Database, chatId: number) {
  const { results } = await db.prepare("SELECT * FROM projects WHERE chat_id = ? AND status = 'active' ORDER BY id DESC").bind(chatId).all();
  return results as any[];
}
async function getAllProjects(db: D1Database, chatId: number) {
  const { results } = await db.prepare("SELECT * FROM projects WHERE chat_id = ? ORDER BY id DESC").bind(chatId).all();
  return results as any[];
}
async function getProjectById(db: D1Database, projectId: number) {
  return await db.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first() as any;
}
async function getProjectMembers(db: D1Database, projectId: number) {
  const { results } = await db.prepare("SELECT * FROM project_members WHERE project_id = ? ORDER BY id ASC").bind(projectId).all();
  return results as { id: number; project_id: number; user_id: number; name: string }[];
}
async function saveDraft(db: D1Database, key: string, data: any) {
  await db.prepare("INSERT OR REPLACE INTO drafts (id, data) VALUES (?, ?)").bind(key, JSON.stringify(data)).run();
}
async function getDraft(db: D1Database, key: string) {
  const row = await db.prepare("SELECT data FROM drafts WHERE id = ?").bind(key).first() as any;
  return row ? JSON.parse(row.data) : null;
}
async function deleteDraft(db: D1Database, key: string) {
  await db.prepare("DELETE FROM drafts WHERE id = ?").bind(key).run();
}

function safeEval(expr: string): number {
  try {
    const sanitized = expr.replace(/[^0-9+\-*/().]/g, '');
    if (!sanitized) return 0;
    return Number(new Function(`return ${sanitized}`)());
  } catch {
    return NaN;
  }
}

async function calculateBalances(db: D1Database, projectId: number) {
  const members = await getProjectMembers(db, projectId);
  const netBalances: Record<number, number> = {};
  const names: Record<number, string> = {};
  const totalPaid: Record<number, number> = {};
  const totalShare: Record<number, number> = {};

  members.forEach(m => {
    netBalances[m.user_id] = 0; names[m.user_id] = m.name;
    totalPaid[m.user_id] = 0; totalShare[m.user_id] = 0;
  });

  const { results: expenses } = await db.prepare("SELECT * FROM expenses WHERE project_id = ?").bind(projectId).all();
  for (const e of (expenses as any[])) {
    if (netBalances[e.payer_id] !== undefined) {
      netBalances[e.payer_id] += Number(e.amount);
      totalPaid[e.payer_id] += Number(e.amount);
    }
    const { results: splits } = await db.prepare("SELECT * FROM expense_splits WHERE expense_id = ?").bind(e.id).all();
    for (const s of (splits as any[])) {
      if (netBalances[s.user_id] !== undefined) {
        netBalances[s.user_id] -= Number(s.share_amount);
        totalShare[s.user_id] += Number(s.share_amount);
      }
    }
  }

  const { results: transfers } = await db.prepare("SELECT * FROM settlements WHERE project_id = ?").bind(projectId).all();
  for (const t of (transfers as any[])) {
    if (netBalances[t.from_user_id] !== undefined) netBalances[t.from_user_id] += Number(t.amount);
    if (netBalances[t.to_user_id] !== undefined) netBalances[t.to_user_id] -= Number(t.amount);
  }
  return { netBalances, names, totalPaid, totalShare, members };
}

function getSettlementTransactions(netBalances: Record<number, number>) {
  const debtors = Object.keys(netBalances).map(id => ({ id: Number(id), bal: netBalances[Number(id)] })).filter(x => x.bal < -0.01).sort((a, b) => a.bal - b.bal);
  const creditors = Object.keys(netBalances).map(id => ({ id: Number(id), bal: netBalances[Number(id)] })).filter(x => x.bal > 0.01).sort((a, b) => b.bal - a.bal);
  const transactions: { from: number; to: number; amount: number }[] = [];
  let i = 0, j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(-debtors[i].bal, creditors[j].bal);
    transactions.push({ from: debtors[i].id, to: creditors[j].id, amount });
    debtors[i].bal += amount;
    creditors[j].bal -= amount;
    if (debtors[i].bal > -0.01) i++;
    if (creditors[j].bal < 0.01) j++;
  }
  return transactions;
}

function solveSettlement(netBalances: Record<number, number>, names: Record<number, string>, currency: string) {
  const txs = getSettlementTransactions(netBalances);
  return txs.map(t => `💸 <b>${names[t.from]}</b> ➔ <b>${names[t.to]}</b>: ${t.amount.toFixed(2)} ${currency}`);
}

// ----------------------------------------------------
// BOT ENTRYPOINT
// ----------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "POST") {
      const bot = new Bot(env.BOT_TOKEN);

      // --- INTERNAL COMMAND PROCESSORS ---
      // We extract these so we can call them from one-line commands OR reply prompts
      
      const processInit = async (ctx: Context, args: string[]) => {
        const name = args[0]; const currency = args[1] || "$";
        const proj = await env.DB.prepare("INSERT INTO projects (chat_id, name, currency) VALUES (?, ?, ?) RETURNING id").bind(ctx.chat.id, name, currency).first() as any;
        await env.DB.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, name) VALUES (?, ?, ?)").bind(proj.id, ctx.from!.id, ctx.from!.first_name).run();

        const kb = new InlineKeyboard().text("✋ Join Project", `join_${proj.id}`).text("✅ Done Adding", `join_done_${proj.id}`);
        await ctx.reply(`🎉 Project <b>${name}</b> (${currency}) created!\n\n👥 <b>Current Members:</b> ${ctx.from!.first_name}\n\nTap <b>Join Project</b> below:`, { parse_mode: "HTML", reply_markup: kb });
      };

      const processExpense = async (ctx: Context, args: string[]) => {
        const amount = parseFloat(args[0]);
        if (isNaN(amount)) return ctx.reply("❌ Invalid amount provided.");
        
        // If no description, use current Date & Time
        let desc = args.slice(1).join(" ");
        if (!desc) {
          desc = new Date().toISOString().replace('T', ' ').substring(0, 16); 
        }

        const draftId = `exp_${ctx.chat.id}_${Date.now()}`;
        const projectId = await routeProjectCommand(ctx, "exp", `${draftId}`);
        await saveDraft(env.DB, draftId, { amount, desc, projectId, payerId: null, splitWith: [] });
        if (projectId) await promptPayerSelection(ctx, env.DB, draftId, projectId, amount, desc);
      };

      const processPay = async (ctx: Context, args: string[]) => {
        const amount = parseFloat(args[0]);
        if (isNaN(amount) || amount <= 0) return ctx.reply("❌ Invalid payment amount.");
        const draftId = `pay_${ctx.chat.id}_${Date.now()}`;
        const projId = await routeProjectCommand(ctx, "pay", draftId);
        await saveDraft(env.DB, draftId, { amount, projectId: projId, fromId: null, toId: null });
        if (projId) await promptPaySender(ctx, env.DB, draftId, projId, amount);
      };

      // --- COMMAND HANDLERS ---

      bot.command("start", async (ctx) => {
        if (ctx.chat.type === "private") return ctx.reply("👋 Welcome to Dong Split Bot!\n\nAdd me to a group to manage trips.\nUse /mybalance here to see what you owe.");
        await ctx.reply("👋 Dong Bot is active!\n\nCreate a project with: <code>/init &lt;Name&gt; &lt;Currency&gt;</code>", { parse_mode: "HTML" });
      });

      bot.command("init", async (ctx) => {
        if (ctx.chat.type === "private") return ctx.reply("Please use /init inside a group chat.");
        const args = ctx.match.trim().split(/\s+/).filter(Boolean);
        if (args.length === 0) {
          return ctx.reply("Reply to this message with your Project Name and Currency (e.g. <code>Trip $</code>):\n\n<span class=\"tg-spoiler\">[Action: init_prompt]</span>", { parse_mode: "HTML", reply_markup: { force_reply: true } });
        }
        await processInit(ctx, args);
      });

      bot.command("expense", async (ctx) => {
        if (ctx.chat.type === "private") return ctx.reply("Use /expense in your group.");
        const args = ctx.match.trim().split(/\s+/).filter(Boolean);
        if (args.length === 0) {
          return ctx.reply("Reply to this message with the Amount and an optional Description (e.g. <code>50000 Taxi</code>):\n\n<span class=\"tg-spoiler\">[Action: expense_prompt]</span>", { parse_mode: "HTML", reply_markup: { force_reply: true } });
        }
        await processExpense(ctx, args);
      });

      bot.command("pay", async (ctx) => {
        if (ctx.chat.type === "private") return ctx.reply("Use /pay in your group.");
        const args = ctx.match.trim().split(/\s+/).filter(Boolean);
        if (args.length === 0) {
          return ctx.reply("Reply to this message with the amount you are transferring (e.g. <code>50000</code>):\n\n<span class=\"tg-spoiler\">[Action: pay_prompt]</span>", { parse_mode: "HTML", reply_markup: { force_reply: true } });
        }
        await processPay(ctx, args);
      });

      // --- GLOBAL MESSAGE CATCHER (FOR REPLIES) ---
      
      bot.on("message:text", async (ctx) => {
        const replyTo = ctx.message.reply_to_message;
        if (!replyTo || !replyTo.text) return;

        // 1. Catch missing argument prompts (Action Prompts)
        const actionMatch = replyTo.text.match(/\[Action:\s*([^\]]+)\]/);
        if (actionMatch) {
          const action = actionMatch[1];
          const args = ctx.message.text.trim().split(/\s+/).filter(Boolean);
          
          if (action === "init_prompt") return processInit(ctx, args);
          if (action === "expense_prompt") return processExpense(ctx, args);
          if (action === "pay_prompt") return processPay(ctx, args);
          return;
        }

        // 2. Catch Unequal Split Math Arrays (Draft Prompts)
        const draftMatch = replyTo.text.match(/\[Draft:\s*(exp_[^\]]+)\]/);
        if (draftMatch) {
          const draftId = draftMatch[1];
          const draft = await getDraft(env.DB, draftId);
          if (!draft || !draft.splitOrder) return ctx.reply("❌ This split session has expired or was already saved.");

          const inputText = ctx.message.text.trim();
          const entries = inputText.split(/[,\s]+/).filter(e => e.length > 0);
          if (entries.length !== draft.splitOrder.length) {
            return ctx.reply(`❌ I need exactly ${draft.splitOrder.length} numbers. You provided ${entries.length}.`);
          }

          const members = await getProjectMembers(env.DB, draft.projectId);
          const userShares: { userId: number; amount: number; name: string }[] = [];
          let totalSum = 0;

          for (let i = 0; i < entries.length; i++) {
            const userId = draft.splitOrder[i];
            const member = members.find(m => m.user_id === userId);
            const amt = safeEval(entries[i]);
            if (isNaN(amt) || amt < 0) return ctx.reply(`❌ Invalid math: '${entries[i]}'`);
            
            userShares.push({ userId, amount: amt, name: member?.name || "Unknown" });
            totalSum += amt;
          }

          if (Math.abs(totalSum - draft.amount) > 0.01) {
            return ctx.reply(`❌ Total mismatch! Your inputs sum to <b>${totalSum}</b>, but the expense is <b>${draft.amount}</b>.`, { parse_mode: "HTML" });
          }

          const exp = await env.DB.prepare("INSERT INTO expenses (project_id, payer_id, amount, description) VALUES (?, ?, ?, ?) RETURNING id").bind(draft.projectId, draft.payerId, draft.amount, draft.desc).first() as any;
          for (const s of userShares) await env.DB.prepare("INSERT INTO expense_splits (expense_id, user_id, share_amount) VALUES (?, ?, ?)").bind(exp.id, s.userId, s.amount).run();
          
          await deleteDraft(env.DB, draftId);
          const kb = new InlineKeyboard().text("↩️ Undo", `delexp_${exp.id}_${draft.projectId}`);
          let reportMsg = `✅ <b>Unequal Expense Saved!</b>\n🧾 <b>${draft.desc}</b> (${draft.amount})\n\n`;
          userShares.forEach(s => reportMsg += `• ${s.name}: ${s.amount}\n`);
          return ctx.reply(reportMsg, { parse_mode: "HTML", reply_markup: kb });
        }
      });

      // --- PROJECT & CALLBACK LOGIC ---

      bot.callbackQuery(/join_(\d+)/, async (ctx) => {
        const projectId = Number(ctx.match[1]);
        await env.DB.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, name) VALUES (?, ?, ?)").bind(projectId, ctx.from.id, ctx.from.first_name).run();
        const members = await getProjectMembers(env.DB, projectId);
        const proj = await getProjectById(env.DB, projectId);
        const kb = new InlineKeyboard().text("✋ Join Project", `join_${projectId}`).text("✅ Done Adding", `join_done_${projectId}`);
        try { await ctx.editMessageText(`🎉 Project <b>${proj.name}</b> (${proj.currency}) created!\n\n👥 <b>Members:</b> ${members.map(m => m.name).join(", ")}\n\nTap <b>Join Project</b> below:`, { parse_mode: "HTML", reply_markup: kb }); } catch (_) {}
        await ctx.answerCallbackQuery("Joined!");
      });

      bot.callbackQuery(/join_done_(\d+)/, async (ctx) => {
        await ctx.editMessageText("✅ Group locked. You can now log expenses with /expense.");
        await ctx.answerCallbackQuery();
      });

      async function routeProjectCommand(ctx: Context, action: string, payload: string = "") {
        const active = await getActiveProjects(env.DB, ctx.chat!.id);
        if (active.length === 0) { await ctx.reply("❌ No active projects."); return null; }
        if (active.length === 1) return active[0].id;
        const kb = new InlineKeyboard();
        for (const p of active) kb.text(`${p.name} (${p.currency})`, `selproj_${action}_${p.id}_${payload}`).row();
        await ctx.reply("📁 Choose a project:", { reply_markup: kb });
        return null;
      }

      bot.callbackQuery(/selproj_exp_(\d+)_(exp_.+)/, async (ctx) => {
        const draft = await getDraft(env.DB, ctx.match[2]);
        if (!draft) return ctx.answerCallbackQuery("Expired");
        draft.projectId = Number(ctx.match[1]);
        await saveDraft(env.DB, ctx.match[2], draft);
        await promptPayerSelection(ctx, env.DB, ctx.match[2], draft.projectId, draft.amount, draft.desc);
        await ctx.answerCallbackQuery();
      });

      async function promptPayerSelection(ctx: Context, db: D1Database, draftId: string, projId: number, amount: number, desc: string) {
        const members = await getProjectMembers(db, projId);
        const kb = new InlineKeyboard();
        members.forEach(m => kb.text(m.name, `exppayer_${draftId}_${m.user_id}`).row());
        const text = `🧾 <b>${desc}</b> (${amount})\n👉 <b>Who paid?</b>`;
        if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
        else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
      }

      bot.callbackQuery(/exppayer_(exp_.+)_(\d+)/, async (ctx) => {
        const draftId = ctx.match[1]; const draft = await getDraft(env.DB, draftId);
        if (!draft) return ctx.answerCallbackQuery("Expired");
        draft.payerId = Number(ctx.match[2]);
        draft.splitWith = (await getProjectMembers(env.DB, draft.projectId)).map(m => m.user_id);
        await saveDraft(env.DB, draftId, draft);
        await renderSplitSelection(ctx, env.DB, draftId, draft);
        await ctx.answerCallbackQuery();
      });

      async function renderSplitSelection(ctx: Context, db: D1Database, draftId: string, draft: any) {
        const members = await getProjectMembers(db, draft.projectId);
        const kb = new InlineKeyboard();
        for (const m of members) {
          kb.text(`${draft.splitWith.includes(m.user_id) ? "✅" : "❌"} ${m.name}`, `exptoggle_${draftId}_${m.user_id}`);
        }
        kb.row().text("⚡ Unequal Split", `expunequal_${draftId}`).text("💾 Confirm Equal", `expconfirm_${draftId}`);
        await ctx.editMessageText(`🧾 <b>${draft.desc}</b> (${draft.amount})\n<i>Toggle who shares this equally, or choose Unequal:</i>`, { parse_mode: "HTML", reply_markup: kb });
      }

      bot.callbackQuery(/exptoggle_(exp_.+)_(\d+)/, async (ctx) => {
        const draft = await getDraft(env.DB, ctx.match[1]); if (!draft) return;
        const uid = Number(ctx.match[2]);
        draft.splitWith = draft.splitWith.includes(uid) ? draft.splitWith.filter((id: number) => id !== uid) : [...draft.splitWith, uid];
        await saveDraft(env.DB, ctx.match[1], draft);
        await renderSplitSelection(ctx, env.DB, ctx.match[1], draft);
      });

      bot.callbackQuery(/expconfirm_(exp_.+)/, async (ctx) => {
        const draft = await getDraft(env.DB, ctx.match[1]);
        if (!draft || draft.splitWith.length === 0) return ctx.answerCallbackQuery("Invalid or empty split!");
        const share = draft.amount / draft.splitWith.length;
        const exp = await env.DB.prepare("INSERT INTO expenses (project_id, payer_id, amount, description) VALUES (?, ?, ?, ?) RETURNING id").bind(draft.projectId, draft.payerId, draft.amount, draft.desc).first() as any;
        for (const uid of draft.splitWith) await env.DB.prepare("INSERT INTO expense_splits (expense_id, user_id, share_amount) VALUES (?, ?, ?)").bind(exp.id, uid, share).run();
        
        await deleteDraft(env.DB, ctx.match[1]);
        const kb = new InlineKeyboard().text("↩️ Undo", `delexp_${exp.id}_${draft.projectId}`);
        await ctx.editMessageText(`✅ <b>Expense Added!</b>\n🧾 ${draft.desc} (${draft.amount})\n\n<i>Split equally between ${draft.splitWith.length} people.</i>`, { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/expunequal_(exp_.+)/, async (ctx) => {
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return ctx.answerCallbackQuery("Expired");

        const members = await getProjectMembers(env.DB, draft.projectId);
        const activeMembers = members.filter(m => draft.splitWith.includes(m.user_id));
        if (activeMembers.length === 0) return ctx.answerCallbackQuery("Select at least 1 person first!");

        draft.splitOrder = activeMembers.map(m => m.user_id);
        await saveDraft(env.DB, draftId, draft);

        let msg = `⚡ <b>Unequal Split:</b> ${draft.desc} (Total: <b>${draft.amount}</b>)\n\n`;
        msg += `Reply to this message with amounts in this order:\n`;
        activeMembers.forEach((m, idx) => { msg += `<b>${idx + 1}.</b> ${m.name}\n`; });
        msg += `\n<i>(e.g., "2000 4000-1000 0")</i>\n\n`;
        msg += `<span class="tg-spoiler">[Draft: ${draftId}]</span>`;

        await ctx.deleteMessage().catch(()=>true);
        await ctx.reply(msg, { parse_mode: "HTML", reply_markup: { force_reply: true } });
        await ctx.answerCallbackQuery();
      });

      // --- PAY CALLBACKS ---
      
      bot.callbackQuery(/selproj_pay_(\d+)_(pay_.+)/, async (ctx) => {
        const draft = await getDraft(env.DB, ctx.match[2]);
        draft.projectId = Number(ctx.match[1]);
        await saveDraft(env.DB, ctx.match[2], draft);
        await promptPaySender(ctx, env.DB, ctx.match[2], draft.projectId, draft.amount);
      });

      async function promptPaySender(ctx: Context, db: D1Database, draftId: string, projId: number, amount: number) {
        const members = await getProjectMembers(db, projId);
        const kb = new InlineKeyboard();
        members.forEach(m => kb.text(m.name, `payfrom_${draftId}_${m.user_id}`).row());
        const text = `💸 <b>Transfer of ${amount}</b>\n👉 <b>Who is paying? (Sender)</b>`;
        ctx.callbackQuery ? await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }) : await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
      }

      bot.callbackQuery(/payfrom_(pay_.+)_(\d+)/, async (ctx) => {
        const draft = await getDraft(env.DB, ctx.match[1]);
        draft.fromId = Number(ctx.match[2]);
        await saveDraft(env.DB, ctx.match[1], draft);
        const members = await getProjectMembers(env.DB, draft.projectId);
        const kb = new InlineKeyboard();
        members.filter(m => m.user_id !== draft.fromId).forEach(m => kb.text(m.name, `payto_${ctx.match[1]}_${m.user_id}`).row());
        await ctx.editMessageText(`💸 <b>Transfer of ${draft.amount}</b>\n👉 <b>Who is receiving?</b>`, { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/payto_(pay_.+)_(\d+)/, async (ctx) => {
        const draft = await getDraft(env.DB, ctx.match[1]);
        const t = await env.DB.prepare("INSERT INTO settlements (project_id, from_user_id, to_user_id, amount) VALUES (?, ?, ?, ?) RETURNING id").bind(draft.projectId, draft.fromId, Number(ctx.match[2]), draft.amount).first() as any;
        await deleteDraft(env.DB, ctx.match[1]);
        
        const kb = new InlineKeyboard().text("↩️ Undo", `delpay_${t.id}_${draft.projectId}`);
        await ctx.editMessageText(`✅ <b>Payment Recorded!</b>\nAmount: ${draft.amount}`, { parse_mode: "HTML", reply_markup: kb });
      });

      // --- DELETE / UNDO HANDLERS ---
      
      bot.callbackQuery(/delexp_(\d+)_(\d+)/, async (ctx) => {
        const expId = Number(ctx.match[1]);
        await env.DB.prepare("DELETE FROM expense_splits WHERE expense_id = ?").bind(expId).run();
        await env.DB.prepare("DELETE FROM expenses WHERE id = ?").bind(expId).run();
        await ctx.editMessageText("🗑️ <i>Expense deleted successfully.</i>", { parse_mode: "HTML" });
      });

      bot.callbackQuery(/delpay_(\d+)_(\d+)/, async (ctx) => {
        const payId = Number(ctx.match[1]);
        await env.DB.prepare("DELETE FROM settlements WHERE id = ?").bind(payId).run();
        await ctx.editMessageText("🗑️ <i>Payment deleted successfully.</i>", { parse_mode: "HTML" });
      });

      // --- BALANCE AND SETTLE ROUTING (Preserved) ---
      
      bot.command("balances", async (ctx) => {
        if (ctx.chat.type === "private") return;
        const projId = await routeProjectCommand(ctx, "bal");
        if (projId) await showBalancesMenu(ctx, env.DB, projId);
      });
      bot.callbackQuery(/selproj_bal_(\d+)_/, async (ctx) => await showBalancesMenu(ctx, env.DB, Number(ctx.match[1])));
      async function showBalancesMenu(ctx: Context, db: D1Database, projId: number) {
        const members = await getProjectMembers(db, projId);
        const proj = await getProjectById(db, projId);
        const kb = new InlineKeyboard();
        members.forEach(m => kb.text(`👤 ${m.name}`, `baluser_${projId}_${m.user_id}`).row());
        const text = `📊 <b>Balances for ${proj.name}:</b>\nTap a member below to see their detailed breakdown:`;
        ctx.callbackQuery ? await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }) : await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
      }

      bot.callbackQuery(/baluser_(\d+)_(\d+)/, async (ctx) => {
        const projId = Number(ctx.match[1]); const userId = Number(ctx.match[2]);
        const proj = await getProjectById(env.DB, projId);
        const { netBalances, names, totalPaid, totalShare } = await calculateBalances(env.DB, projId);
        const myBal = netBalances[userId] || 0; const myName = names[userId];
        
        let msg = `👤 <b>Balance Breakdown for ${myName}</b> (${proj.name})\n\n`;
        const transactions = getSettlementTransactions(netBalances);
        const myDebts = transactions.filter(t => t.from === userId);
        const myCredits = transactions.filter(t => t.to === userId);

        if (myDebts.length > 0 || myCredits.length > 0) {
          msg += `🧾 <b>Actionable Debts:</b>\n`;
          myDebts.forEach(d => msg += `🔴 Owes <b>${d.amount.toFixed(2)}</b> to ${names[d.to]}\n`);
          myCredits.forEach(c => msg += `🟢 Gets <b>${c.amount.toFixed(2)}</b> from ${names[c.from]}\n`);
          msg += `\n`;
        } else { msg += `✅ <b>No pending debts!</b>\n\n`; }

        msg += `💰 <b>Total Paid Out:</b> ${totalPaid[userId]?.toFixed(2)} ${proj.currency}\n`;
        msg += `🍽️ <b>Total Consumed:</b> ${totalShare[userId]?.toFixed(2)} ${proj.currency}\n`;
        msg += `------------------------------------\n`;
        if (myBal > 0.01) msg += `🟢 <b>Overall Total:</b> Gets back <b>+${myBal.toFixed(2)} ${proj.currency}</b>`;
        else if (myBal < -0.01) msg += `🔴 <b>Overall Total:</b> Owes <b>${myBal.toFixed(2)} ${proj.currency}</b>`;
        else msg += `⚪ <b>Overall Total:</b> Settled ($0.00)`;

        const kb = new InlineKeyboard().text("« Back to Members", `selproj_bal_${projId}_`);
        await ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb });
        await ctx.answerCallbackQuery();
      });

      bot.command("settle", async (ctx) => {
        if (ctx.chat.type === "private") return;
        const projId = await routeProjectCommand(ctx, "settle");
        if (projId) await showSettlement(ctx, env.DB, projId);
      });
      bot.callbackQuery(/selproj_settle_(\d+)_/, async (ctx) => await showSettlement(ctx, env.DB, Number(ctx.match[1])));
      async function showSettlement(ctx: Context, db: D1Database, projId: number) {
        const proj = await getProjectById(db, projId);
        const { netBalances, names } = await calculateBalances(db, projId);
        const steps = solveSettlement(netBalances, names, proj.currency);
        let report = `⚖️ <b>Optimal Settlement Plan for ${proj.name}:</b>\n\n`;
        if (steps.length === 0) report += "✅ <b>All settled up!</b> Everyone is at 0 balance.";
        else report += steps.join("\n") + "\n\n<i>Tip: Use /pay to record transfers.</i>";
        ctx.callbackQuery ? await ctx.editMessageText(report, { parse_mode: "HTML" }) : await ctx.reply(report, { parse_mode: "HTML" });
      }

      bot.command("ledger", async (ctx) => {
        if (ctx.chat.type === "private") return;
        const projId = await routeProjectCommand(ctx, "ledger");
        if (projId) await showLedger(ctx, env.DB, projId);
      });
      bot.callbackQuery(/selproj_ledger_(\d+)/, async (ctx) => await showLedger(ctx, env.DB, Number(ctx.match[1])));
      async function showLedger(ctx: Context, db: D1Database, projId: number) {
        const { results: exps } = await db.prepare("SELECT * FROM expenses WHERE project_id = ? ORDER BY id DESC LIMIT 5").bind(projId).all();
        const { results: pays } = await db.prepare("SELECT * FROM settlements WHERE project_id = ? ORDER BY id DESC LIMIT 5").bind(projId).all();
        const kb = new InlineKeyboard(); let hasData = false;
        (exps as any[]).forEach(e => { kb.text(`❌ Exp: ${e.description} (${e.amount})`, `delexp_${e.id}_${projId}`).row(); hasData = true; });
        (pays as any[]).forEach(p => { kb.text(`❌ Pay: Transfer (${p.amount})`, `delpay_${p.id}_${projId}`).row(); hasData = true; });
        const text = hasData ? "📖 <b>Recent Ledger:</b>\nTap the ❌ next to an item to delete it permanently." : "📖 Ledger is empty.";
        ctx.callbackQuery ? await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }) : await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
      }

      return webhookCallback(bot, "cloudflare-mod")(request);
    }
    // --- /REPORT COMMAND ---
      bot.command("report", async (ctx) => {
        if (ctx.chat.type === "private") return;
        const projId = await routeProjectCommand(ctx, "report");
        if (projId) await showReport(ctx, env.DB, projId);
      });

      bot.callbackQuery(/selproj_report_(\d+)_/, async (ctx) => {
        await showReport(ctx, env.DB, Number(ctx.match[1]));
        await ctx.answerCallbackQuery();
      });

      async function showReport(ctx: Context, db: D1Database, projId: number) {
        const proj = await getProjectById(db, projId);
        const { netBalances, names, totalPaid, members } = await calculateBalances(db, projId);

        const expSumRow = await db.prepare("SELECT SUM(amount) as total, COUNT(id) as count FROM expenses WHERE project_id = ?").bind(projId).first() as any;
        const totalExp = expSumRow?.total || 0;
        const countExp = expSumRow?.count || 0;

        let msg = `📈 <b>Full Report: ${proj.name}</b> (${proj.status.toUpperCase()})\n\n`;
        msg += `💵 <b>Total Expenses:</b> ${totalExp.toFixed(2)} ${proj.currency} (${countExp} entries)\n\n`;
        msg += `👥 <b>Individual Spending:</b>\n`;
        
        for (const m of members) {
          const paid = totalPaid[m.user_id] || 0;
          const bal = netBalances[m.user_id] || 0;
          msg += `• <b>${m.name}:</b> Paid ${paid.toFixed(2)} ${proj.currency} | Net: ${bal >= 0 ? "+" : ""}${bal.toFixed(2)}\n`;
        }

        ctx.callbackQuery ? await ctx.editMessageText(msg, { parse_mode: "HTML" }) : await ctx.reply(msg, { parse_mode: "HTML" });
      }

      // --- /HISTORY COMMAND ---
      bot.command("history", async (ctx) => {
        if (ctx.chat.type === "private") return ctx.reply("Use /history inside your group.");
        const projects = await getAllProjects(env.DB, ctx.chat.id);
        if (projects.length === 0) return ctx.reply("No projects found for this group.");

        const kb = new InlineKeyboard();
        for (const p of projects) {
          const statusIcon = p.status === "active" ? "🟢" : "🔒";
          kb.text(`${statusIcon} ${p.name} (${p.currency})`, `selproj_report_${p.id}_`).row();
        }
        await ctx.reply("📜 <b>Project History:</b>\nSelect any project to view its full report:", { parse_mode: "HTML", reply_markup: kb });
      });

      // --- /END COMMAND ---
      bot.command("end", async (ctx) => {
        if (ctx.chat.type === "private") return ctx.reply("Use /end inside your group.");
        const active = await getActiveProjects(env.DB, ctx.chat.id);
        if (active.length === 0) return ctx.reply("No active projects to close.");

        const kb = new InlineKeyboard();
        for (const p of active) {
          kb.text(`Close: ${p.name}`, `endproj_${p.id}`).row();
        }
        await ctx.reply("⚠️ <b>Select a project to close:</b>\n(Note: All balances must be settled first)", { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/endproj_(\d+)/, async (ctx) => {
        const projId = Number(ctx.match[1]);
        const proj = await getProjectById(env.DB, projId);
        const { netBalances } = await calculateBalances(env.DB, projId);

        // Check if anyone has a balance greater than 0.01 (cents)
        const unsettled = Object.values(netBalances).some(b => Math.abs(b) > 0.01);
        if (unsettled) {
          await ctx.editMessageText(
            `❌ <b>Cannot close ${proj.name}!</b>\n\nThere are still unsettled debts. Run /settle to see who needs to pay whom, and log payments with /pay.`,
            { parse_mode: "HTML" }
          );
          return ctx.answerCallbackQuery();
        }

        await env.DB.prepare("UPDATE projects SET status = 'ended' WHERE id = ?").bind(projId).run();
        await ctx.editMessageText(`🔒 <b>Project ${proj.name} is now officially closed and archived.</b>`, { parse_mode: "HTML" });
        await ctx.answerCallbackQuery();
      });
    return new Response("Bot is active.", { status: 200 });
  },
};