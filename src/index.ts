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
  const { results } = await db.prepare("SELECT * FROM project_members WHERE project_id = ?").bind(projectId).all();
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

// Calculates net balances for every member in a project
async function calculateBalances(db: D1Database, projectId: number) {
  const members = await getProjectMembers(db, projectId);
  const netBalances: Record<number, number> = {};
  const names: Record<number, string> = {};
  const totalPaid: Record<number, number> = {};
  const totalShare: Record<number, number> = {};

  members.forEach(m => {
    netBalances[m.user_id] = 0;
    names[m.user_id] = m.name;
    totalPaid[m.user_id] = 0;
    totalShare[m.user_id] = 0;
  });

  // 1. Expenses
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

  // 2. Direct peer transfers (/pay)
  const { results: transfers } = await db.prepare("SELECT * FROM settlements WHERE project_id = ?").bind(projectId).all();
  for (const t of (transfers as any[])) {
    if (netBalances[t.from_user_id] !== undefined) netBalances[t.from_user_id] += Number(t.amount);
    if (netBalances[t.to_user_id] !== undefined) netBalances[t.to_user_id] -= Number(t.amount);
  }

  return { netBalances, names, totalPaid, totalShare, members };
}

// Debt minimization algorithm (N members -> max N-1 transfers)
function solveSettlement(netBalances: Record<number, number>, names: Record<number, string>, currency: string) {
  const debtors = Object.keys(netBalances)
    .map(id => ({ id: Number(id), bal: netBalances[Number(id)] }))
    .filter(x => x.bal < -0.01)
    .sort((a, b) => a.bal - b.bal);

  const creditors = Object.keys(netBalances)
    .map(id => ({ id: Number(id), bal: netBalances[Number(id)] }))
    .filter(x => x.bal > 0.01)
    .sort((a, b) => b.bal - a.bal);

  const transactions: string[] = [];
  let i = 0, j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debt = -debtors[i].bal;
    const credit = creditors[j].bal;
    const amount = Math.min(debt, credit);

    transactions.push(`💸 <b>${names[debtors[i].id]}</b> ➔ <b>${names[creditors[j].id]}</b>: ${amount.toFixed(2)} ${currency}`);

    debtors[i].bal += amount;
    creditors[j].bal -= amount;

    if (debtors[i].bal > -0.01) i++;
    if (creditors[j].bal < 0.01) j++;
  }

  return transactions;
}

// ----------------------------------------------------
// BOT ENTRYPOINT
// ----------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "POST") {
      const bot = new Bot(env.BOT_TOKEN);

      // --- /start ---
      bot.command("start", async (ctx) => {
        if (ctx.chat.type === "private") {
          return ctx.reply("👋 Welcome to Dong Split Bot!\n\nAdd me to a group to manage trips and split payments with friends.\n\nUse /mybalance here in private chat to see what you owe across all your groups.");
        }
        await ctx.reply("👋 Dong Bot is active!\n\nCreate a project with: <code>/init &lt;Name&gt; &lt;Currency&gt;</code>\nExample: <code>/init Istanbul $</code>", { parse_mode: "HTML" });
      });

      // --- Private chat personal balances ---
      bot.command("mybalance", async (ctx) => {
        if (ctx.chat.type !== "private") return ctx.reply("Use /balances inside your group, or use /mybalance in private chat.");
        const userId = ctx.from!.id;
        const { results: memberships } = await env.DB.prepare(
          "SELECT p.id, p.name, p.currency FROM project_members pm JOIN projects p ON pm.project_id = p.id WHERE pm.user_id = ? AND p.status = 'active'"
        ).bind(userId).all();

        if (!memberships || memberships.length === 0) {
          return ctx.reply("You are not part of any active projects.");
        }

        let report = `👤 <b>Your Balances Across All Trips:</b>\n\n`;
        for (const proj of (memberships as any[])) {
          const { netBalances } = await calculateBalances(env.DB, proj.id);
          const bal = netBalances[userId] || 0;
          const icon = bal >= 0 ? "🟢" : "🔴";
          report += `${icon} <b>${proj.name}:</b> ${bal >= 0 ? "+" : ""}${bal.toFixed(2)} ${proj.currency}\n`;
        }
        await ctx.reply(report, { parse_mode: "HTML" });
      });

      // --- /init <name> <currency> ---
      bot.command("init", async (ctx) => {
        if (ctx.chat.type === "private") return ctx.reply("Please use /init inside a group chat.");
        const args = ctx.match.trim().split(/\s+/);
        if (!args[0]) return ctx.reply("Usage: <code>/init &lt;ProjectName&gt; [Currency]</code>\nExample: <code>/init NorthTrip $</code>", { parse_mode: "HTML" });

        const name = args[0];
        const currency = args[1] || "$";

        const proj = await env.DB.prepare("INSERT INTO projects (chat_id, name, currency) VALUES (?, ?, ?) RETURNING id")
          .bind(ctx.chat.id, name, currency).first() as any;

        // Auto-add creator
        await env.DB.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, name) VALUES (?, ?, ?)")
          .bind(proj.id, ctx.from!.id, ctx.from!.first_name).run();

        const kb = new InlineKeyboard()
          .text("✋ Join Project", `join_${proj.id}`)
          .text("✅ Done Adding", `join_done_${proj.id}`);

        await ctx.reply(
          `🎉 Project <b>${name}</b> (${currency}) created!\n\n` +
          `👥 <b>Current Members:</b> ${ctx.from!.first_name}\n\n` +
          `Everyone in this trip, tap <b>Join Project</b> below:`,
          { parse_mode: "HTML", reply_markup: kb }
        );
      });

      // Join buttons
      bot.callbackQuery(/join_(\d+)/, async (ctx) => {
        const projectId = Number(ctx.match[1]);
        const userId = ctx.from.id;
        const name = ctx.from.first_name;

        await env.DB.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, name) VALUES (?, ?, ?)")
          .bind(projectId, userId, name).run();

        const members = await getProjectMembers(env.DB, projectId);
        const names = members.map(m => m.name).join(", ");
        const proj = await getProjectById(env.DB, projectId);

        const kb = new InlineKeyboard()
          .text("✋ Join Project", `join_${projectId}`)
          .text("✅ Done Adding", `join_done_${projectId}`);

        try {
          await ctx.editMessageText(
            `🎉 Project <b>${proj.name}</b> (${proj.currency}) created!\n\n` +
            `👥 <b>Current Members:</b> ${names}\n\n` +
            `Everyone in this trip, tap <b>Join Project</b> below:`,
            { parse_mode: "HTML", reply_markup: kb }
          );
        } catch (_) {}
        await ctx.answerCallbackQuery({ text: "You joined the project!" });
      });

      bot.callbackQuery(/join_done_(\d+)/, async (ctx) => {
        const projectId = Number(ctx.match[1]);
        const members = await getProjectMembers(env.DB, projectId);
        const proj = await getProjectById(env.DB, projectId);
        await ctx.editMessageText(
          `🚀 Project <b>${proj.name}</b> is active with ${members.length} members: ${members.map(m => m.name).join(", ")}.\n\nYou can now log expenses with /expense.`,
          { parse_mode: "HTML" }
        );
        await ctx.answerCallbackQuery();
      });

      // --- Helper: Multi-Project Guard ---
      async function routeProjectCommand(ctx: Context, action: string, payload: string = "") {
        const active = await getActiveProjects(env.DB, ctx.chat!.id);
        if (active.length === 0) {
          await ctx.reply("❌ No active projects. Create one with <code>/init &lt;name&gt; &lt;currency&gt;</code>", { parse_mode: "HTML" });
          return null;
        }
        if (active.length === 1) {
          return active[0].id;
        }
        // Multiple projects: prompt selection
        const kb = new InlineKeyboard();
        for (const p of active) {
          kb.text(`${p.name} (${p.currency})`, `selproj_${action}_${p.id}_${payload}`).row();
        }
        await ctx.reply("📁 Multiple active projects found. Choose one:", { reply_markup: kb });
        return null;
      }

      // --- /expense <amount> <description> ---
      bot.command("expense", async (ctx) => {
        if (ctx.chat.type === "private") return ctx.reply("Use /expense in your group.");
        const args = ctx.match.trim().split(/\s+/);
        if (args.length < 2 || isNaN(Number(args[0]))) {
          return ctx.reply("Usage: <code>/expense &lt;amount&gt; &lt;description&gt;</code>\nExample: <code>/expense 50000 Dinner</code>", { parse_mode: "HTML" });
        }

        const amount = parseFloat(args[0]);
        const desc = args.slice(1).join(" ");
        const draftId = `exp_${ctx.chat.id}_${Date.now()}`;

        const projectId = await routeProjectCommand(ctx, "exp", `${draftId}`);
        await saveDraft(env.DB, draftId, { amount, desc, projectId, payerId: null, splitWith: [] });

        if (projectId) {
          await promptPayerSelection(ctx, env.DB, draftId, projectId, amount, desc);
        }
      });

      // Callback when project is selected from multiple
      bot.callbackQuery(/selproj_exp_(\d+)_(exp_.+)/, async (ctx) => {
        const projectId = Number(ctx.match[1]);
        const draftId = ctx.match[2];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return ctx.answerCallbackQuery("Session expired.");
        draft.projectId = projectId;
        await saveDraft(env.DB, draftId, draft);
        await promptPayerSelection(ctx, env.DB, draftId, projectId, draft.amount, draft.desc);
        await ctx.answerCallbackQuery();
      });

      async function promptPayerSelection(ctx: Context, db: D1Database, draftId: string, projId: number, amount: number, desc: string) {
        const members = await getProjectMembers(db, projId);
        const proj = await getProjectById(db, projId);
        const kb = new InlineKeyboard();
        for (const m of members) {
          kb.text(m.name, `exppayer_${draftId}_${m.user_id}`).row();
        }
        const text = `🧾 <b>Expense:</b> ${desc}\n💵 <b>Amount:</b> ${amount} ${proj.currency}\n\n👉 <b>Who paid for this?</b>`;
        if (ctx.callbackQuery) {
          await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
        } else {
          await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
        }
      }

      // Step 2 of expense: choose who shares
      bot.callbackQuery(/exppayer_(exp_.+)_(\d+)/, async (ctx) => {
        const draftId = ctx.match[1];
        const payerId = Number(ctx.match[2]);
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return ctx.answerCallbackQuery("Session expired.");

        const members = await getProjectMembers(env.DB, draft.projectId);
        draft.payerId = payerId;
        // Default: everyone shares
        draft.splitWith = members.map(m => m.user_id);
        await saveDraft(env.DB, draftId, draft);

        await renderSplitSelection(ctx, env.DB, draftId, draft);
        await ctx.answerCallbackQuery();
      });

      async function renderSplitSelection(ctx: Context, db: D1Database, draftId: string, draft: any) {
        const members = await getProjectMembers(db, draft.projectId);
        const proj = await getProjectById(db, draft.projectId);
        const payerName = members.find(m => m.user_id === draft.payerId)?.name || "Unknown";

        const kb = new InlineKeyboard();
        for (const m of members) {
          const checked = draft.splitWith.includes(m.user_id);
          kb.text(`${checked ? "✅" : "❌"} ${m.name}`, `exptoggle_${draftId}_${m.user_id}`);
        }
        kb.row()
          .text("⚡ Unequal Split", `expunequal_${draftId}`)
          .text("💾 Confirm Split", `expconfirm_${draftId}`);

        const text = `🧾 <b>Expense:</b> ${draft.desc}\n💵 <b>Amount:</b> ${draft.amount} ${proj.currency}\n👤 <b>Payer:</b> ${payerName}\n\n<i>Toggle who shares this expense:</i>`;
        await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
      }

      // Toggle member in split
      bot.callbackQuery(/exptoggle_(exp_.+)_(\d+)/, async (ctx) => {
        const draftId = ctx.match[1];
        const userId = Number(ctx.match[2]);
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return ctx.answerCallbackQuery("Session expired.");

        if (draft.splitWith.includes(userId)) {
          draft.splitWith = draft.splitWith.filter((id: number) => id !== userId);
        } else {
          draft.splitWith.push(userId);
        }
        await saveDraft(env.DB, draftId, draft);
        await renderSplitSelection(ctx, env.DB, draftId, draft);
        await ctx.answerCallbackQuery();
      });

      // Confirm equal split
      bot.callbackQuery(/expconfirm_(exp_.+)/, async (ctx) => {
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return ctx.answerCallbackQuery("Session expired.");
        if (draft.splitWith.length === 0) return ctx.answerCallbackQuery("Select at least 1 person!");

        const share = draft.amount / draft.splitWith.length;
        const exp = await env.DB.prepare("INSERT INTO expenses (project_id, payer_id, amount, description) VALUES (?, ?, ?, ?) RETURNING id")
          .bind(draft.projectId, draft.payerId, draft.amount, draft.desc).first() as any;

        for (const uid of draft.splitWith) {
          await env.DB.prepare("INSERT INTO expense_splits (expense_id, user_id, share_amount) VALUES (?, ?, ?)")
            .bind(exp.id, uid, share).run();
        }

        const proj = await getProjectById(env.DB, draft.projectId);
        const members = await getProjectMembers(env.DB, draft.projectId);
        const payerName = members.find(m => m.user_id === draft.payerId)?.name || "Unknown";
        const sharedNames = members.filter(m => draft.splitWith.includes(m.user_id)).map(m => m.name).join(", ");

        await deleteDraft(env.DB, draftId);
        await ctx.editMessageText(
          `✅ <b>Expense Added!</b>\n\n` +
          `🧾 <b>Description:</b> ${draft.desc}\n` +
          `💵 <b>Total:</b> ${draft.amount} ${proj.currency}\n` +
          `👤 <b>Paid by:</b> ${payerName}\n` +
          `👥 <b>Split equally (${share.toFixed(2)} each) among:</b> ${sharedNames}`,
          { parse_mode: "HTML" }
        );
        await ctx.answerCallbackQuery();
      });

      // Unequal split prompt
      bot.callbackQuery(/expunequal_(exp_.+)/, async (ctx) => {
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return ctx.answerCallbackQuery("Session expired.");

        const members = await getProjectMembers(env.DB, draft.projectId);
        const memberList = members.map(m => m.name).join(", ");

        await ctx.reply(
          `⚡ <b>Unequal Split for:</b> ${draft.desc} (${draft.amount})\n\n` +
          `Reply to this message with exact amounts for members:\n` +
          `<code>/customsplit ${draftId} Name1 Amount1, Name2 Amount2</code>\n\n` +
          `Example:\n<code>/customsplit ${draftId} ${members[0]?.name || "Ali"} ${Math.round(draft.amount * 0.6)}, ${members[1]?.name || "Reza"} ${Math.round(draft.amount * 0.4)}</code>`,
          { parse_mode: "HTML" }
        );
        await ctx.answerCallbackQuery();
      });

      bot.command("customsplit", async (ctx) => {
        const parts = ctx.match.trim().split(/\s+/);
        const draftId = parts[0];
        const splitText = parts.slice(1).join(" ");

        const draft = await getDraft(env.DB, draftId);
        if (!draft) return ctx.reply("Draft session expired or invalid.");

        const members = await getProjectMembers(env.DB, draft.projectId);
        const entries = splitText.split(",").map(s => s.trim());
        const userShares: { userId: number; amount: number; name: string }[] = [];
        let totalSum = 0;

        for (const entry of entries) {
          const [name, amtStr] = entry.split(/\s+/);
          const amt = parseFloat(amtStr);
          const member = members.find(m => m.name.toLowerCase() === name.toLowerCase());
          if (!member || isNaN(amt)) {
            return ctx.reply(`❌ Could not understand '${entry}'. Ensure member names match exactly: ${members.map(m => m.name).join(", ")}`);
          }
          userShares.push({ userId: member.user_id, amount: amt, name: member.name });
          totalSum += amt;
        }

        if (Math.abs(totalSum - draft.amount) > 0.01) {
          return ctx.reply(`❌ The sum of shares (${totalSum}) does not match the expense amount (${draft.amount}). Difference: ${(draft.amount - totalSum).toFixed(2)}`);
        }

        // Save
        const exp = await env.DB.prepare("INSERT INTO expenses (project_id, payer_id, amount, description) VALUES (?, ?, ?, ?) RETURNING id")
          .bind(draft.projectId, draft.payerId, draft.amount, draft.desc).first() as any;

        for (const s of userShares) {
          await env.DB.prepare("INSERT INTO expense_splits (expense_id, user_id, share_amount) VALUES (?, ?, ?)")
            .bind(exp.id, s.userId, s.amount).run();
        }

        await deleteDraft(env.DB, draftId);
        await ctx.reply(
          `✅ <b>Unequal Expense Saved!</b>\n\n🧾 <b>${draft.desc}</b> (${draft.amount})\n` +
          userShares.map(s => `• ${s.name}: ${s.amount}`).join("\n"),
          { parse_mode: "HTML" }
        );
      });

      // --- /balances ---
      bot.command("balances", async (ctx) => {
        if (ctx.chat.type === "private") return ctx.reply("Use /balances inside your group.");
        const projId = await routeProjectCommand(ctx, "bal");
        if (projId) await showBalancesMenu(ctx, env.DB, projId);
      });

      bot.callbackQuery(/selproj_bal_(\d+)_/, async (ctx) => {
        const projId = Number(ctx.match[1]);
        await showBalancesMenu(ctx, env.DB, projId);
        await ctx.answerCallbackQuery();
      });

      async function showBalancesMenu(ctx: Context, db: D1Database, projId: number) {
        const members = await getProjectMembers(db, projId);
        const proj = await getProjectById(db, projId);
        const kb = new InlineKeyboard();
        for (const m of members) {
          kb.text(`👤 ${m.name}`, `baluser_${projId}_${m.user_id}`).row();
        }
        const text = `📊 <b>Balances for ${proj.name}:</b>\nTap a member below to see their detailed breakdown:`;
        if (ctx.callbackQuery) {
          await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
        } else {
          await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
        }
      }

      bot.callbackQuery(/baluser_(\d+)_(\d+)/, async (ctx) => {
        const projId = Number(ctx.match[1]);
        const userId = Number(ctx.match[2]);
        const proj = await getProjectById(env.DB, projId);
        const { netBalances, names, totalPaid, totalShare } = await calculateBalances(env.DB, projId);

        const myBal = netBalances[userId] || 0;
        const myName = names[userId];

        let msg = `👤 <b>Balance Breakdown for ${myName}</b> (${proj.name})\n\n`;
        msg += `💰 <b>Total Paid Out:</b> ${totalPaid[userId]?.toFixed(2)} ${proj.currency}\n`;
        msg += `🍽️ <b>Total Consumed:</b> ${totalShare[userId]?.toFixed(2)} ${proj.currency}\n`;
        msg += `------------------------------------\n`;
        if (myBal > 0.01) {
          msg += `🟢 <b>Overall Status:</b> Gets back <b>+${myBal.toFixed(2)} ${proj.currency}</b>`;
        } else if (myBal < -0.01) {
          msg += `🔴 <b>Overall Status:</b> Owes <b>${myBal.toFixed(2)} ${proj.currency}</b>`;
        } else {
          msg += `⚪ <b>Overall Status:</b> Settled ($0.00)`;
        }

        const kb = new InlineKeyboard().text("« Back to Members", `selproj_bal_${projId}_`);
        await ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb });
        await ctx.answerCallbackQuery();
      });

      // --- /pay <amount> (Direct Peer Settlement) ---
      bot.command("pay", async (ctx) => {
        if (ctx.chat.type === "private") return ctx.reply("Use /pay inside your group.");
        const args = ctx.match.trim();
        const amount = parseFloat(args);
        if (isNaN(amount) || amount <= 0) {
          return ctx.reply("Usage: <code>/pay &lt;amount&gt;</code>\nExample: <code>/pay 5000</code>", { parse_mode: "HTML" });
        }

        const draftId = `pay_${ctx.chat.id}_${Date.now()}`;
        const projId = await routeProjectCommand(ctx, "pay", `${draftId}`);
        await saveDraft(env.DB, draftId, { amount, projectId: projId, fromId: null, toId: null });

        if (projId) {
          await promptPaySender(ctx, env.DB, draftId, projId, amount);
        }
      });

      bot.callbackQuery(/selproj_pay_(\d+)_(pay_.+)/, async (ctx) => {
        const projId = Number(ctx.match[1]);
        const draftId = ctx.match[2];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return ctx.answerCallbackQuery("Expired");
        draft.projectId = projId;
        await saveDraft(env.DB, draftId, draft);
        await promptPaySender(ctx, env.DB, draftId, projId, draft.amount);
        await ctx.answerCallbackQuery();
      });

      async function promptPaySender(ctx: Context, db: D1Database, draftId: string, projId: number, amount: number) {
        const members = await getProjectMembers(db, projId);
        const proj = await getProjectById(db, projId);
        const kb = new InlineKeyboard();
        for (const m of members) {
          kb.text(m.name, `payfrom_${draftId}_${m.user_id}`).row();
        }
        const text = `💸 <b>Transfer of ${amount} ${proj.currency}</b>\n\n👉 <b>Who is paying? (Sender)</b>`;
        if (ctx.callbackQuery) {
          await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
        } else {
          await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
        }
      }

      bot.callbackQuery(/payfrom_(pay_.+)_(\d+)/, async (ctx) => {
        const draftId = ctx.match[1];
        const fromId = Number(ctx.match[2]);
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return ctx.answerCallbackQuery("Expired");
        draft.fromId = fromId;
        await saveDraft(env.DB, draftId, draft);

        const members = await getProjectMembers(env.DB, draft.projectId);
        const proj = await getProjectById(env.DB, draft.projectId);
        const fromName = members.find(m => m.user_id === fromId)?.name;

        const kb = new InlineKeyboard();
        for (const m of members) {
          if (m.user_id !== fromId) {
            kb.text(m.name, `payto_${draftId}_${m.user_id}`).row();
          }
        }
        await ctx.editMessageText(
          `💸 <b>Transfer of ${draft.amount} ${proj.currency}</b>\n👤 <b>Sender:</b> ${fromName}\n\n👉 <b>Who is receiving the payment? (Receiver)</b>`,
          { parse_mode: "HTML", reply_markup: kb }
        );
        await ctx.answerCallbackQuery();
      });

      bot.callbackQuery(/payto_(pay_.+)_(\d+)/, async (ctx) => {
        const draftId = ctx.match[1];
        const toId = Number(ctx.match[2]);
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return ctx.answerCallbackQuery("Expired");

        await env.DB.prepare("INSERT INTO settlements (project_id, from_user_id, to_user_id, amount) VALUES (?, ?, ?, ?)")
          .bind(draft.projectId, draft.fromId, toId, draft.amount).run();

        const members = await getProjectMembers(env.DB, draft.projectId);
        const proj = await getProjectById(env.DB, draft.projectId);
        const fromName = members.find(m => m.user_id === draft.fromId)?.name;
        const toName = members.find(m => m.user_id === toId)?.name;

        await deleteDraft(env.DB, draftId);
        await ctx.editMessageText(
          `✅ <b>Payment Recorded!</b>\n\n💸 <b>${fromName}</b> paid <b>${draft.amount} ${proj.currency}</b> to <b>${toName}</b>.`,
          { parse_mode: "HTML" }
        );
        await ctx.answerCallbackQuery();
      });

      // --- /settle ---
      bot.command("settle", async (ctx) => {
        if (ctx.chat.type === "private") return ctx.reply("Use /settle inside your group.");
        const projId = await routeProjectCommand(ctx, "settle");
        if (projId) await showSettlement(ctx, env.DB, projId);
      });

      bot.callbackQuery(/selproj_settle_(\d+)_/, async (ctx) => {
        const projId = Number(ctx.match[1]);
        await showSettlement(ctx, env.DB, projId);
        await ctx.answerCallbackQuery();
      });

      async function showSettlement(ctx: Context, db: D1Database, projId: number) {
        const proj = await getProjectById(db, projId);
        const { netBalances, names } = await calculateBalances(db, projId);
        const steps = solveSettlement(netBalances, names, proj.currency);

        let report = `⚖️ <b>Optimal Settlement Plan for ${proj.name}:</b>\n\n`;
        if (steps.length === 0) {
          report += "✅ <b>All settled up!</b> Everyone is at 0 balance.";
        } else {
          report += steps.join("\n") + "\n\n<i>Tip: Use /pay &lt;amount&gt; once transfers are done.</i>";
        }

        if (ctx.callbackQuery) {
          await ctx.editMessageText(report, { parse_mode: "HTML" });
        } else {
          await ctx.reply(report, { parse_mode: "HTML" });
        }
      }

      // --- /report ---
      bot.command("report", async (ctx) => {
        if (ctx.chat.type === "private") return ctx.reply("Use /report inside your group.");
        const projId = await routeProjectCommand(ctx, "report");
        if (projId) await showReport(ctx, env.DB, projId);
      });

      bot.callbackQuery(/selproj_report_(\d+)_/, async (ctx) => {
        const projId = Number(ctx.match[1]);
        await showReport(ctx, env.DB, projId);
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

        if (ctx.callbackQuery) {
          await ctx.editMessageText(msg, { parse_mode: "HTML" });
        } else {
          await ctx.reply(msg, { parse_mode: "HTML" });
        }
      }

      // --- /history ---
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

      // --- /end ---
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

      return webhookCallback(bot, "cloudflare-mod")(request);
    }

    return new Response("Bot is active.", { status: 200 });
  },
};