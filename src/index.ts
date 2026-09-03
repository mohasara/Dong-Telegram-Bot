import { Bot, webhookCallback, InlineKeyboard, Context } from "grammy";

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
}

// ----------------------------------------------------
// DATABASE & COMPUTATION HELPERS
// ----------------------------------------------------

function getChatIds(chatId: number): number[] {
  const ids = new Set<number>();
  ids.add(chatId);
  const s = chatId.toString();

  if (s.startsWith("-100")) {
    const raw = s.slice(4);
    if (raw) {
      ids.add(-Number(raw));
      ids.add(Number(raw));
    }
  } else if (s.startsWith("-")) {
    const raw = s.slice(1);
    if (raw) {
      ids.add(-Number(`100${raw}`));
      ids.add(Number(raw));
    }
  } else {
    ids.add(-chatId);
    ids.add(-Number(`100${chatId}`));
    if (s.startsWith("100")) {
      const raw = s.slice(3);
      if (raw) {
        ids.add(Number(raw));
        ids.add(-Number(raw));
        ids.add(-Number(`100${raw}`));
      }
    }
  }
  return Array.from(ids).filter(n => !isNaN(n));
}

async function getActiveProjects(db: D1Database, chatId: number) {
  const ids = getChatIds(chatId);
  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await db.prepare(
    `SELECT * FROM projects WHERE chat_id IN (${placeholders}) AND status = 'active' ORDER BY id DESC`
  ).bind(...ids).all();
  return results as any[];
}

async function getAllProjects(db: D1Database, chatId: number) {
  const ids = getChatIds(chatId);
  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await db.prepare(
    `SELECT * FROM projects WHERE chat_id IN (${placeholders}) ORDER BY id DESC`
  ).bind(...ids).all();
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

async function deleteMessages(ctx: Context, chatId: number, messageIds: (number | undefined | null)[]) {
  const uniqueIds = Array.from(new Set(messageIds.filter((id): id is number => typeof id === 'number' && id > 0)));
  if (uniqueIds.length === 0) return;
  try {
    await ctx.api.deleteMessages(chatId, uniqueIds);
  } catch (_) {
    await Promise.all(uniqueIds.map(async (msgId) => {
      try {
        await ctx.api.deleteMessage(chatId, msgId);
      } catch (_) {}
    }));
  }
}

// NATIVE MATH EVALUATOR
function safeEval(expr: string): number {
  const persian = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
  const arabic  = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
  for (let i = 0; i < 10; i++) {
    expr = expr.replace(persian[i], i.toString()).replace(arabic[i], i.toString());
  }

  expr = expr.replace(/[^0-9+\-*/().]/g, '');
  if (!expr) return NaN;

  let pos = 0;
  function parseExpression(): number {
    let val = parseTerm();
    while (pos < expr.length) {
      if (expr[pos] === '+') { pos++; val += parseTerm(); }
      else if (expr[pos] === '-') { pos++; val -= parseTerm(); }
      else break;
    }
    return val;
  }
  function parseTerm(): number {
    let val = parseFactor();
    while (pos < expr.length) {
      if (expr[pos] === '*') { pos++; val *= parseFactor(); }
      else if (expr[pos] === '/') { pos++; val /= parseFactor(); }
      else break;
    }
    return val;
  }
  function parseFactor(): number {
    if (expr[pos] === '+') { pos++; return parseFactor(); }
    if (expr[pos] === '-') { pos++; return -parseFactor(); }
    if (expr[pos] === '(') {
      pos++;
      let val = parseExpression();
      if (expr[pos] === ')') pos++;
      return val;
    }
    let start = pos;
    while (pos < expr.length && /[0-9.]/.test(expr[pos])) pos++;
    const numStr = expr.substring(start, pos);
    return numStr ? parseFloat(numStr) : NaN;
  }

  const result = parseExpression();
  if (pos < expr.length) return NaN;
  return isNaN(result) ? NaN : result;
}

function parseMathInput(raw: string): { mathExpr: string; desc: string } {
  const persian = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
  const arabic  = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
  let text = (raw || "").trim();
  for (let i = 0; i < 10; i++) {
    text = text.replace(persian[i], i.toString()).replace(arabic[i], i.toString());
  }

  const tokens = text.split(/\s+/).filter(Boolean);
  const mathTokens: string[] = [];
  const descTokens: string[] = [];
  let foundDesc = false;

  for (const token of tokens) {
    if (!foundDesc) {
      if (/^[0-9+\-*/().]+$/.test(token)) {
        mathTokens.push(token);
      } else {
        foundDesc = true;
        descTokens.push(token);
      }
    } else {
      descTokens.push(token);
    }
  }

  // If the last math token is an operator and we have description tokens, move it to description
  while (mathTokens.length > 1 && /^[+\-*/]+$/.test(mathTokens[mathTokens.length - 1]) && descTokens.length > 0) {
    descTokens.unshift(mathTokens.pop()!);
  }

  const mathExpr = mathTokens.join("");
  const desc = descTokens.join(" ");
  return { mathExpr, desc };
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
  return txs.map(t => `💸 <b>${names[t.from] || 'Unknown'}</b> ➔ <b>${names[t.to] || 'Unknown'}</b>: ${t.amount.toFixed(2)}${currency ? ' ' + currency : ''}`);
}

async function routeProjectCommand(ctx: Context, db: D1Database, action: string, payload: string = "", cmdMsgId: number = 0): Promise<{ projectId: number | null }> {
  if (!ctx.chat) return { projectId: null };
  const active = await getActiveProjects(db, ctx.chat.id);
  if (active.length === 0) { await ctx.reply("❌ No active projects."); return { projectId: null }; }
  if (active.length === 1) return { projectId: active[0].id };
  const kb = new InlineKeyboard();
  for (const p of active) {
    const fullPayload = payload || (cmdMsgId ? `${cmdMsgId}` : "");
    const data = fullPayload ? `selproj_${action}_${p.id}_${fullPayload}` : `selproj_${action}_${p.id}`;
    kb.text(`${p.name}${p.currency ? ' (' + p.currency + ')' : ''}`, data).row();
  }
  if (payload.startsWith("exp_") || payload.startsWith("pay_")) {
    kb.text("❌ Cancel", `canceldraft_${payload}`).row();
  } else if (cmdMsgId) {
    kb.text("❌ Close", `closeflow_${cmdMsgId}`).row();
  } else {
    kb.text("❌ Close", "closemsg").row();
  }
  await ctx.reply("📁 Choose a project:", { reply_markup: kb });
  return { projectId: null };
}

// ----------------------------------------------------
// BOT ENTRYPOINT
// ----------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "POST") {
      const bot = new Bot(env.BOT_TOKEN);

      const processNew = async (ctx: Context, args: string[], initialMsgIds: number[] = []) => {
        if (!ctx.chat) return;
        if (!args || args.length === 0) return ctx.reply("❌ Missing project name.");
        const name = args[0]; const currency = args[1] || "";
        const proj = await env.DB.prepare("INSERT INTO projects (chat_id, name, currency) VALUES (?, ?, ?) RETURNING id").bind(ctx.chat.id, name, currency).first() as any;
        await env.DB.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, name) VALUES (?, ?, ?)").bind(proj.id, ctx.from!.id, ctx.from!.first_name).run();

        const mainCmdId = initialMsgIds[0] || 0;
        const kb = new InlineKeyboard().text("✋ Join Project", `join_${proj.id}`).text("✅ Done Adding", `join_done_${proj.id}_${mainCmdId}`);
        await ctx.reply(`🎉 Project <b>${name}</b>${currency ? ' (' + currency + ')' : ''} created!\n\n👥 <b>Current Members:</b> ${ctx.from!.first_name}\n\nTap <b>Join Project</b> below:`, { parse_mode: "HTML", reply_markup: kb });

        if (initialMsgIds.length > 0) {
          await deleteMessages(ctx, ctx.chat.id, initialMsgIds);
        }
      };

      const processAdd = async (ctx: Context, args: string[], initialMsgIds: number[] = []) => {
        if (!ctx.chat) return;
        const raw = (args || []).join(" ");
        const { mathExpr, desc: parsedDesc } = parseMathInput(raw);
        if (!mathExpr) return ctx.reply("❌ Missing expense amount.");
        const evaluated = safeEval(mathExpr);
        if (isNaN(evaluated) || evaluated <= 0) return ctx.reply(`❌ Invalid math or amount: '<code>${mathExpr}</code>'`, { parse_mode: "HTML" });
        const amount = Math.round(evaluated * 100) / 100;
        
        let desc = parsedDesc;
        if (!desc) {
          desc = new Date().toISOString().replace('T', ' ').substring(0, 16); 
        }

        const draftId = `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const { projectId } = await routeProjectCommand(ctx, env.DB, "add", draftId);
        await saveDraft(env.DB, draftId, { amount, desc, projectId, payerId: null, splitWith: [], msgIds: initialMsgIds });
        if (projectId) await promptPayerSelection(ctx, env.DB, draftId, projectId, amount, desc);
      };

      const processPay = async (ctx: Context, args: string[], initialMsgIds: number[] = []) => {
        if (!ctx.chat) return;
        const raw = (args || []).join(" ");
        const { mathExpr } = parseMathInput(raw);
        if (!mathExpr) return ctx.reply("❌ Missing payment amount.");
        const evaluated = safeEval(mathExpr);
        if (isNaN(evaluated) || evaluated <= 0) return ctx.reply(`❌ Invalid math or amount: '<code>${mathExpr}</code>'`, { parse_mode: "HTML" });
        const amount = Math.round(evaluated * 100) / 100;
        const draftId = `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const { projectId } = await routeProjectCommand(ctx, env.DB, "pay", draftId);
        await saveDraft(env.DB, draftId, { amount, projectId, fromId: null, toId: null, msgIds: initialMsgIds });
        if (projectId) await promptPaySender(ctx, env.DB, draftId, projectId, amount);
      };

      // ====================================================
      // 1. COMMANDS
      // ====================================================

      bot.command("start", async (ctx) => {
        if (!ctx.chat) return;
        if (ctx.chat.type === "private") return ctx.reply("👋 Welcome to Dong Split Bot!\n\nAdd me to a group to manage shared expenses.\nUse /mybalance here to see what you owe.");
        await ctx.reply("👋 Dong Bot is active!\n\nCreate a project with: <code>/new &lt;Name&gt; [Currency]</code>", { parse_mode: "HTML" });
      });

      bot.command("mybalance", async (ctx) => {
        if (!ctx.chat) return;
        if (ctx.chat.type !== "private") return ctx.reply("Use /balances inside your group, or use /mybalance in private chat.");
        const userId = ctx.from!.id;
        const { results: memberships } = await env.DB.prepare(
          "SELECT p.id, p.name, p.currency FROM project_members pm JOIN projects p ON pm.project_id = p.id WHERE pm.user_id = ? AND p.status = 'active'"
        ).bind(userId).all();

        if (!memberships || memberships.length === 0) return ctx.reply("You are not part of any active projects.");

        let report = `👤 <b>Your Balances Across All Projects:</b>\n\n`;
        for (const proj of (memberships as any[])) {
          const { netBalances } = await calculateBalances(env.DB, proj.id);
          const bal = netBalances[userId] || 0;
          const icon = bal >= 0 ? "🟢" : "🔴";
          report += `${icon} <b>${proj.name}:</b> ${bal >= 0 ? "+" : ""}${bal.toFixed(2)}${proj.currency ? ' ' + proj.currency : ''}\n`;
        }
        await ctx.reply(report, { parse_mode: "HTML" });
      });

      bot.command("new", async (ctx) => {
        if (!ctx.chat) return;
        if (ctx.chat.type === "private") return ctx.reply("Please use /new inside a group chat.");
        const cmdMsgId = ctx.message?.message_id || 0;
        const args = ctx.match.trim().split(/\s+/).filter(Boolean);
        if (args.length === 0) {
          return ctx.reply(
            `Reply to this message with your Project Name and Currency (e.g. <code>Party $</code>):\n\n<span class="tg-spoiler">[Action: new_prompt_${cmdMsgId}]</span>`,
            { parse_mode: "HTML", reply_parameters: cmdMsgId ? { message_id: cmdMsgId } : undefined, reply_markup: { force_reply: true, selective: true } }
          );
        }
        await processNew(ctx, args, cmdMsgId ? [cmdMsgId] : []);
      });

      bot.command("add", async (ctx) => {
        if (!ctx.chat) return;
        if (ctx.chat.type === "private") return ctx.reply("Use /add in your group.");
        const cmdMsgId = ctx.message?.message_id || 0;
        const args = ctx.match.trim().split(/\s+/).filter(Boolean);
        if (args.length === 0) {
          return ctx.reply(
            `Reply to this message with the Amount and an optional Description (e.g. <code>50000 Taxi</code> or <code>2000+3000 Taxi</code>):\n\n<span class="tg-spoiler">[Action: add_prompt_${cmdMsgId}]</span>`,
            { parse_mode: "HTML", reply_parameters: cmdMsgId ? { message_id: cmdMsgId } : undefined, reply_markup: { force_reply: true, selective: true } }
          );
        }
        await processAdd(ctx, args, cmdMsgId ? [cmdMsgId] : []);
      });

      bot.command("pay", async (ctx) => {
        if (!ctx.chat) return;
        if (ctx.chat.type === "private") return ctx.reply("Use /pay in your group.");
        const cmdMsgId = ctx.message?.message_id || 0;
        const args = ctx.match.trim().split(/\s+/).filter(Boolean);
        if (args.length === 0) {
          return ctx.reply(
            `Reply to this message with the amount you are transferring (e.g. <code>50000</code> or <code>10000/2</code>):\n\n<span class="tg-spoiler">[Action: pay_prompt_${cmdMsgId}]</span>`,
            { parse_mode: "HTML", reply_parameters: cmdMsgId ? { message_id: cmdMsgId } : undefined, reply_markup: { force_reply: true, selective: true } }
          );
        }
        await processPay(ctx, args, cmdMsgId ? [cmdMsgId] : []);
      });

      bot.command("balances", async (ctx) => {
        if (!ctx.chat) return;
        const cmdMsgId = ctx.message?.message_id || 0;
        const { projectId } = await routeProjectCommand(ctx, env.DB, "bal", "", cmdMsgId);
        if (projectId) await showBalancesMenu(ctx, env.DB, projectId, cmdMsgId);
      });

      bot.command("settle", async (ctx) => {
        if (!ctx.chat) return;
        const cmdMsgId = ctx.message?.message_id || 0;
        const { projectId } = await routeProjectCommand(ctx, env.DB, "settle", "", cmdMsgId);
        if (projectId) await showSettlement(ctx, env.DB, projectId, cmdMsgId);
      });

      bot.command("delete", async (ctx) => {
        if (!ctx.chat) return;
        const cmdMsgId = ctx.message?.message_id || 0;
        const { projectId } = await routeProjectCommand(ctx, env.DB, "delete", "", cmdMsgId);
        if (projectId) await showLedger(ctx, env.DB, projectId, cmdMsgId);
      });

      bot.command("report", async (ctx) => {
        if (!ctx.chat) return;
        const cmdMsgId = ctx.message?.message_id || 0;
        const { projectId } = await routeProjectCommand(ctx, env.DB, "report", "", cmdMsgId);
        if (projectId) await showReport(ctx, env.DB, projectId, cmdMsgId);
      });

      bot.command("projects", async (ctx) => {
        if (!ctx.chat) return;
        const projects = await getAllProjects(env.DB, ctx.chat.id);
        if (projects.length === 0) return ctx.reply("No projects found for this group.");

        const cmdMsgId = ctx.message?.message_id || 0;
        const kb = new InlineKeyboard();
        for (const p of projects) {
          const statusIcon = p.status === "active" ? "🟢" : "🔒";
          const data = cmdMsgId ? `selproj_report_${p.id}_${cmdMsgId}` : `selproj_report_${p.id}`;
          kb.text(`${statusIcon} ${p.name}${p.currency ? ' (' + p.currency + ')' : ''}`, data).row();
        }
        kb.text("❌ Close", cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        await ctx.reply("📜 <b>All Projects:</b>\nSelect any project to view its full report:", { parse_mode: "HTML", reply_markup: kb });
      });

      bot.command("close", async (ctx) => {
        if (!ctx.chat) return;
        const active = await getActiveProjects(env.DB, ctx.chat.id);
        if (active.length === 0) return ctx.reply("No active projects to close.");

        const cmdMsgId = ctx.message?.message_id || 0;
        const kb = new InlineKeyboard();
        for (const p of active) {
          const data = cmdMsgId ? `closeproj_${p.id}_${cmdMsgId}` : `closeproj_${p.id}`;
          kb.text(`Close: ${p.name}`, data).row();
        }
        kb.text("❌ Close", cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        await ctx.reply("⚠️ <b>Select a project to close:</b>\n(Note: All balances must be settled first)", { parse_mode: "HTML", reply_markup: kb });
      });

      // ====================================================
      // 2. MESSAGE CATCHER (CLEANS UP ONLY WHEN JOB IS FINISHED)
      // ====================================================
      
      bot.on("message:text", async (ctx, next) => {
        const replyTo = ctx.message.reply_to_message;
        if (!replyTo || !replyTo.text) return next();

        // Catch missing argument prompts
        const actionMatch = replyTo.text.match(/\[Action:\s*(new_prompt|add_prompt|pay_prompt)(?:_(\d+))?\]/);
        if (actionMatch) {
          const action = actionMatch[1];
          const origCmdId = actionMatch[2] ? Number(actionMatch[2]) : 0;
          const args = ctx.message.text.trim().split(/\s+/).filter(Boolean);
          
          const promptMsgIds = [replyTo.message_id, ctx.message.message_id];
          if (origCmdId) {
            promptMsgIds.push(origCmdId);
          }
          const parentMsgId = (replyTo as any).reply_to_message?.message_id;
          if (parentMsgId && !promptMsgIds.includes(parentMsgId)) {
            promptMsgIds.push(parentMsgId);
          }
          
          if (action === "new_prompt") return processNew(ctx, args, promptMsgIds);
          if (action === "add_prompt") return processAdd(ctx, args, promptMsgIds);
          if (action === "pay_prompt") return processPay(ctx, args, promptMsgIds);
          return next();
        }

        // Catch Unequal Split Arrays
        const draftMatch = replyTo.text.match(/\[Draft:\s*(exp_[^\]]+)\]/);
        if (draftMatch) {
          const draftId = draftMatch[1];
          const draft = await getDraft(env.DB, draftId);
          if (!draft || !draft.splitOrder) return ctx.reply("❌ This split session has expired.");

          const normalizedText = ctx.message.text.trim().replace(/\s*([+\-*/()])\s*/g, '$1');
          const entries = normalizedText.split(/[,\s]+/).filter(e => e.length > 0);

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
          const allIds = Array.from(new Set([...(draft.msgIds || []), ctx.message.message_id])).filter((id): id is number => typeof id === "number" && id > 0);
          const idsPayload = allIds.join("_");
          const kb = new InlineKeyboard()
            .text("↩️ Undo", `delexp_${exp.id}_${draft.projectId}`)
            .text("❌ Close", idsPayload ? `closeflow_${idsPayload}` : "closemsg");
          let reportMsg = `✅ <b>Unequal Expense Saved!</b>\n🧾 <b>${draft.desc}</b> (${draft.amount})\n\n`;
          userShares.forEach(s => reportMsg += `• ${s.name}: ${s.amount}\n`);
          await ctx.reply(reportMsg, { parse_mode: "HTML", reply_markup: kb });

          // ONLY delete intermediate flow messages AFTER the last message of this flow
          if (ctx.chat && allIds.length > 0) {
            await deleteMessages(ctx, ctx.chat.id, allIds);
          }
          return;
        }

        return next();
      });

      // ====================================================
      // 3. CALLBACK QUERY HANDLERS (BUTTON CLICKS)
      // ====================================================

      bot.callbackQuery(/^join_(\d+)$/, async (ctx) => {
        const projectId = Number(ctx.match[1]);
        await env.DB.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, name) VALUES (?, ?, ?)").bind(projectId, ctx.from.id, ctx.from.first_name).run();
        const members = await getProjectMembers(env.DB, projectId);
        const proj = await getProjectById(env.DB, projectId);
        if (proj) {
          const kb = new InlineKeyboard().text("✋ Join Project", `join_${projectId}`).text("✅ Done Adding", `join_done_${projectId}`);
          try { await ctx.editMessageText(`🎉 Project <b>${proj.name}</b>${proj.currency ? ' (' + proj.currency + ')' : ''} created!\n\n👥 <b>Members:</b> ${members.map(m => m.name).join(", ")}\n\nTap <b>Join Project</b> below:`, { parse_mode: "HTML", reply_markup: kb }); } catch (_) {}
        }
        await ctx.answerCallbackQuery("Joined!").catch(() => {});
      });

      bot.callbackQuery(/^join_done_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;
        const kb = new InlineKeyboard().text("❌ Close", cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        try {
          await ctx.editMessageText("✅ Group locked. You can now log expenses with /add.", { reply_markup: kb });
        } catch (_) {}
      });

      // --- ADD EXPENSE CALLBACKS ---
      bot.callbackQuery(/^selproj_add_(\d+)_(exp_.+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[2];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        draft.projectId = Number(ctx.match[1]);
        await saveDraft(env.DB, draftId, draft);
        await promptPayerSelection(ctx, env.DB, draftId, draft.projectId, draft.amount, draft.desc);
      });

      bot.callbackQuery(/^exppayer_(exp_.+)_(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        draft.payerId = Number(ctx.match[2]);
        draft.splitWith = (await getProjectMembers(env.DB, draft.projectId)).map(m => m.user_id);
        await saveDraft(env.DB, draftId, draft);
        await renderSplitSelection(ctx, env.DB, draftId, draft);
      });

      async function promptPayerSelection(ctx: Context, db: D1Database, draftId: string, projId: number, amount: number, desc: string) {
        const members = await getProjectMembers(db, projId);
        if (members.length === 0) {
          const text = `❌ <b>No members in this project yet!</b>\nUse /new or tap Join Project first.`;
          const kb = new InlineKeyboard().text("❌ Cancel", `canceldraft_${draftId}`);
          if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
          else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
          return;
        }
        const kb = new InlineKeyboard();
        for (let i = 0; i < members.length; i++) {
          kb.text(members[i].name, `exppayer_${draftId}_${members[i].user_id}`);
          if (i % 2 === 1) kb.row();
        }
        if (members.length % 2 !== 0) kb.row();
        kb.text("❌ Cancel", `canceldraft_${draftId}`);

        const text = `🧾 <b>${desc}</b> (${amount})\n👉 <b>Who paid?</b>`;
        if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
        else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
      }

      async function renderSplitSelection(ctx: Context, db: D1Database, draftId: string, draft: any) {
        const members = await getProjectMembers(db, draft.projectId);
        const kb = new InlineKeyboard();
        for (let i = 0; i < members.length; i++) {
          const m = members[i];
          kb.text(`${draft.splitWith.includes(m.user_id) ? "✅" : "❌"} ${m.name}`, `exptoggle_${draftId}_${m.user_id}`);
          if (i % 2 === 1) kb.row();
        }
        if (members.length % 2 !== 0) kb.row();

        kb.text("⚡ Unequal Split", `expunequal_${draftId}`).text("💾 Confirm Equal", `expconfirm_${draftId}`).row();
        kb.text("❌ Cancel", `canceldraft_${draftId}`);
        await ctx.editMessageText(`🧾 <b>${draft.desc}</b> (${draft.amount})\n<i>Toggle who shares this equally, or choose Unequal:</i>`, { parse_mode: "HTML", reply_markup: kb });
      }

      bot.callbackQuery(/^exptoggle_(exp_.+)_(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        const uid = Number(ctx.match[2]);
        draft.splitWith = draft.splitWith.includes(uid) ? draft.splitWith.filter((id: number) => id !== uid) : [...draft.splitWith, uid];
        await saveDraft(env.DB, draftId, draft);
        await renderSplitSelection(ctx, env.DB, draftId, draft);
      });

      bot.callbackQuery(/^expconfirm_(exp_.+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft || !draft.splitWith || draft.splitWith.length === 0) return;
        const share = draft.amount / draft.splitWith.length;
        const exp = await env.DB.prepare("INSERT INTO expenses (project_id, payer_id, amount, description) VALUES (?, ?, ?, ?) RETURNING id").bind(draft.projectId, draft.payerId, draft.amount, draft.desc).first() as any;
        for (const uid of draft.splitWith) await env.DB.prepare("INSERT INTO expense_splits (expense_id, user_id, share_amount) VALUES (?, ?, ?)").bind(exp.id, uid, share).run();
        
        await deleteDraft(env.DB, draftId);
        const idsPayload = (draft.msgIds || []).filter((id: any): id is number => typeof id === "number" && id > 0).join("_");
        const kb = new InlineKeyboard()
          .text("↩️ Undo", `delexp_${exp.id}_${draft.projectId}`)
          .text("❌ Close", idsPayload ? `closeflow_${idsPayload}` : "closemsg");
        await ctx.editMessageText(`✅ <b>Expense Saved!</b>\n🧾 <b>${draft.desc}</b> (${draft.amount})\n\n<i>Split equally between ${draft.splitWith.length} people.</i>`, { parse_mode: "HTML", reply_markup: kb });

        // Delete previous messages of this flow after showing the last message
        if (ctx.chat && draft.msgIds && draft.msgIds.length > 0) {
          await deleteMessages(ctx, ctx.chat.id, draft.msgIds);
        }
      });

      bot.callbackQuery(/^expunequal_(exp_.+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;

        const members = await getProjectMembers(env.DB, draft.projectId);
        const activeMembers = members.filter(m => draft.splitWith.includes(m.user_id));
        if (activeMembers.length === 0) return;

        draft.splitOrder = activeMembers.map(m => m.user_id);

        let msg = `⚡ <b>Unequal Split:</b> ${draft.desc} (Total: <b>${draft.amount}</b>)\n\n`;
        msg += `Reply to this message with amounts in this order:\n`;
        activeMembers.forEach((m, idx) => { msg += `<b>${idx + 1}.</b> ${m.name}\n`; });
        msg += `\n<i>(e.g., "2000 4000-1000 0")</i>\n\n`;
        msg += `<span class="tg-spoiler">[Draft: ${draftId}]</span>`;

        // Keep the menu message visible during flow; record it to delete at the end
        const menuMsgId = ctx.callbackQuery.message?.message_id;
        const promptMsg = await ctx.reply(msg, { parse_mode: "HTML", reply_markup: { force_reply: true } });

        draft.msgIds = Array.from(new Set([...(draft.msgIds || []), ...(menuMsgId ? [menuMsgId] : []), promptMsg.message_id]));
        await saveDraft(env.DB, draftId, draft);
      });

      // --- PAY CALLBACKS ---
      bot.callbackQuery(/^selproj_pay_(\d+)_(pay_.+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[2];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        draft.projectId = Number(ctx.match[1]);
        await saveDraft(env.DB, draftId, draft);
        await promptPaySender(ctx, env.DB, draftId, draft.projectId, draft.amount);
      });

      async function promptPaySender(ctx: Context, db: D1Database, draftId: string, projId: number, amount: number) {
        const members = await getProjectMembers(db, projId);
        if (members.length === 0) {
          const text = `❌ <b>No members in this project yet!</b>`;
          const kb = new InlineKeyboard().text("❌ Cancel", `canceldraft_${draftId}`);
          if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
          else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
          return;
        }
        const kb = new InlineKeyboard();
        for (let i = 0; i < members.length; i++) {
          kb.text(members[i].name, `payfrom_${draftId}_${members[i].user_id}`);
          if (i % 2 === 1) kb.row();
        }
        if (members.length % 2 !== 0) kb.row();
        kb.text("❌ Cancel", `canceldraft_${draftId}`);

        const text = `💸 <b>Transfer of ${amount}</b>\n👉 <b>Who is paying? (Sender)</b>`;
        if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
        else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
      }

      bot.callbackQuery(/^payfrom_(pay_.+)_(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        draft.fromId = Number(ctx.match[2]);
        await saveDraft(env.DB, draftId, draft);
        const members = await getProjectMembers(env.DB, draft.projectId);
        const receivers = members.filter(m => m.user_id !== draft.fromId);
        if (receivers.length === 0) {
          const kb = new InlineKeyboard().text("❌ Cancel", `canceldraft_${draftId}`);
          await ctx.editMessageText(`❌ <b>No other members to transfer to!</b>`, { parse_mode: "HTML", reply_markup: kb });
          return;
        }
        const kb = new InlineKeyboard();
        for (let i = 0; i < receivers.length; i++) {
          kb.text(receivers[i].name, `payto_${draftId}_${receivers[i].user_id}`);
          if (i % 2 === 1) kb.row();
        }
        if (receivers.length % 2 !== 0) kb.row();
        kb.text("❌ Cancel", `canceldraft_${draftId}`);
        await ctx.editMessageText(`💸 <b>Transfer of ${draft.amount}</b>\n👉 <b>Who is receiving?</b>`, { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^payto_(pay_.+)_(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        const t = await env.DB.prepare("INSERT INTO settlements (project_id, from_user_id, to_user_id, amount) VALUES (?, ?, ?, ?) RETURNING id").bind(draft.projectId, draft.fromId, Number(ctx.match[2]), draft.amount).first() as any;
        await deleteDraft(env.DB, draftId);
        const idsPayload = (draft.msgIds || []).filter((id: any): id is number => typeof id === "number" && id > 0).join("_");
        const kb = new InlineKeyboard()
          .text("↩️ Undo", `delpay_${t.id}_${draft.projectId}`)
          .text("❌ Close", idsPayload ? `closeflow_${idsPayload}` : "closemsg");
        await ctx.editMessageText(`✅ <b>Payment Recorded!</b>\nAmount: ${draft.amount}`, { parse_mode: "HTML", reply_markup: kb });

        // Delete original command and prompts at the end of the payment flow
        if (ctx.chat && draft.msgIds && draft.msgIds.length > 0) {
          await deleteMessages(ctx, ctx.chat.id, draft.msgIds);
        }
      });

      // --- DELETE / UNDO HANDLERS ---
      bot.callbackQuery(/^delexp_(\d+)_(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery("Deleted!").catch(() => {});
        const expId = Number(ctx.match[1]);
        await env.DB.prepare("DELETE FROM expense_splits WHERE expense_id = ?").bind(expId).run();
        await env.DB.prepare("DELETE FROM expenses WHERE id = ?").bind(expId).run();
        const kb = new InlineKeyboard().text("❌ Close", "closemsg");
        await ctx.editMessageText("🗑️ <i>Expense deleted successfully.</i>", { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^delpay_(\d+)_(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery("Deleted!").catch(() => {});
        const payId = Number(ctx.match[1]);
        await env.DB.prepare("DELETE FROM settlements WHERE id = ?").bind(payId).run();
        const kb = new InlineKeyboard().text("❌ Close", "closemsg");
        await ctx.editMessageText("🗑️ <i>Payment deleted successfully.</i>", { parse_mode: "HTML", reply_markup: kb });
      });

      // --- CALLBACKS FOR BALANCES, SETTLE, DELETE, REPORT & CLOSE ---
      bot.callbackQuery(/^selproj_bal_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;
        await showBalancesMenu(ctx, env.DB, Number(ctx.match[1]), cmdMsgId);
      });

      async function showBalancesMenu(ctx: Context, db: D1Database, projId: number, cmdMsgId: number = 0) {
        const members = await getProjectMembers(db, projId);
        const proj = await getProjectById(db, projId);
        if (!proj) return;
        if (members.length === 0) {
          const text = `📊 <b>Balances for ${proj.name}:</b>\nNo members in this project yet.`;
          const kb = new InlineKeyboard().text("❌ Close", cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
          if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
          else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
          return;
        }
        const kb = new InlineKeyboard();
        for (let i = 0; i < members.length; i++) {
          const data = cmdMsgId ? `baluser_${projId}_${members[i].user_id}_${cmdMsgId}` : `baluser_${projId}_${members[i].user_id}`;
          kb.text(`👤 ${members[i].name}`, data);
          if (i % 2 === 1) kb.row();
        }
        if (members.length % 2 !== 0) kb.row();
        kb.text("❌ Close", cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");

        const text = `📊 <b>Balances for ${proj.name}:</b>\nTap a member below to see their detailed breakdown:`;
        if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
        else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
      }

      bot.callbackQuery(/^baluser_(\d+)_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const projId = Number(ctx.match[1]);
        const userId = Number(ctx.match[2]);
        const cmdMsgId = ctx.match[3] ? Number(ctx.match[3]) : 0;
        const proj = await getProjectById(env.DB, projId);
        if (!proj) return;
        const { netBalances, names, totalPaid, totalShare } = await calculateBalances(env.DB, projId);
        const myBal = netBalances[userId] || 0;
        const myName = names[userId] || "Member";
        
        let msg = `👤 <b>Balance Breakdown for ${myName}</b> (${proj.name})\n\n`;
        const transactions = getSettlementTransactions(netBalances);
        const myDebts = transactions.filter(t => t.from === userId);
        const myCredits = transactions.filter(t => t.to === userId);

        if (myDebts.length > 0 || myCredits.length > 0) {
          msg += `🧾 <b>Actionable Debts:</b>\n`;
          myDebts.forEach(d => msg += `🔴 Owes <b>${d.amount.toFixed(2)}</b> to ${names[d.to] || 'Unknown'}\n`);
          myCredits.forEach(c => msg += `🟢 Gets <b>${c.amount.toFixed(2)}</b> from ${names[c.from] || 'Unknown'}\n`);
          msg += `\n`;
        } else {
          msg += `✅ <b>No pending debts!</b>\n\n`;
        }

        msg += `💰 <b>Total Paid Out:</b> ${totalPaid[userId]?.toFixed(2) || '0.00'}${proj.currency ? ' ' + proj.currency : ''}\n`;
        msg += `🍽️ <b>Total Consumed:</b> ${totalShare[userId]?.toFixed(2) || '0.00'}${proj.currency ? ' ' + proj.currency : ''}\n`;
        msg += `------------------------------------\n`;
        if (myBal > 0.01) msg += `🟢 <b>Overall Total:</b> Gets back <b>+${myBal.toFixed(2)}${proj.currency ? ' ' + proj.currency : ''}</b>`;
        else if (myBal < -0.01) msg += `🔴 <b>Overall Total:</b> Owes <b>${myBal.toFixed(2)}${proj.currency ? ' ' + proj.currency : ''}</b>`;
        else msg += `⚪ <b>Overall Total:</b> Settled ($0.00)`;

        const backData = cmdMsgId ? `selproj_bal_${projId}_${cmdMsgId}` : `selproj_bal_${projId}`;
        const kb = new InlineKeyboard()
          .text("« Back to Members", backData)
          .text("❌ Close", cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        await ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^selproj_settle_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;
        await showSettlement(ctx, env.DB, Number(ctx.match[1]), cmdMsgId);
      });

      async function showSettlement(ctx: Context, db: D1Database, projId: number, cmdMsgId: number = 0) {
        const proj = await getProjectById(db, projId);
        if (!proj) return;
        const { netBalances, names } = await calculateBalances(db, projId);
        const steps = solveSettlement(netBalances, names, proj.currency);
        let report = `⚖️ <b>Optimal Settlement Plan for ${proj.name}:</b>\n\n`;
        if (steps.length === 0) report += "✅ <b>All settled up!</b> Everyone is at 0 balance.";
        else report += steps.join("\n") + "\n\n<i>Tip: Use /pay to record transfers.</i>";
        const kb = new InlineKeyboard().text("❌ Close", cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        if (ctx.callbackQuery) await ctx.editMessageText(report, { parse_mode: "HTML", reply_markup: kb });
        else await ctx.reply(report, { parse_mode: "HTML", reply_markup: kb });
      }

      bot.callbackQuery(/^selproj_delete_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;
        await showLedger(ctx, env.DB, Number(ctx.match[1]), cmdMsgId);
      });

      async function showLedger(ctx: Context, db: D1Database, projId: number, cmdMsgId: number = 0) {
        const proj = await getProjectById(db, projId);
        if (!proj) return;
        const { results: exps } = await db.prepare("SELECT * FROM expenses WHERE project_id = ? ORDER BY id DESC LIMIT 5").bind(projId).all();
        const { results: pays } = await db.prepare("SELECT * FROM settlements WHERE project_id = ? ORDER BY id DESC LIMIT 5").bind(projId).all();
        const kb = new InlineKeyboard();
        (exps as any[]).forEach(e => { kb.text(`❌ Exp: ${e.description} (${e.amount})`, `delexp_${e.id}_${projId}`).row(); });
        (pays as any[]).forEach(p => { kb.text(`❌ Pay: Transfer (${p.amount})`, `delpay_${p.id}_${projId}`).row(); });
        const text = (exps.length > 0 || pays.length > 0) ? "📖 <b>Recent Ledger:</b>\nTap the ❌ next to an item to delete it permanently." : "📖 Ledger is empty.";
        kb.text("❌ Close", cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
        else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
      }

      bot.callbackQuery(/^selproj_report_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;
        await showReport(ctx, env.DB, Number(ctx.match[1]), cmdMsgId);
      });

      async function showReport(ctx: Context, db: D1Database, projId: number, cmdMsgId: number = 0) {
        const proj = await getProjectById(db, projId);
        if (!proj) return;
        const { netBalances, names, totalPaid, members } = await calculateBalances(db, projId);

        const expSumRow = await db.prepare("SELECT SUM(amount) as total, COUNT(id) as count FROM expenses WHERE project_id = ?").bind(projId).first() as any;
        const totalExp = expSumRow?.total || 0;
        const countExp = expSumRow?.count || 0;

        let msg = `📈 <b>Full Report: ${proj.name}</b> (${proj.status.toUpperCase()})\n\n`;
        msg += `💵 <b>Total Expenses:</b> ${totalExp.toFixed(2)}${proj.currency ? ' ' + proj.currency : ''} (${countExp} entries)\n\n`;
        msg += `👥 <b>Individual Spending:</b>\n`;
        
        for (const m of members) {
          const paid = totalPaid[m.user_id] || 0;
          const bal = netBalances[m.user_id] || 0;
          msg += `• <b>${m.name}:</b> Paid ${paid.toFixed(2)}${proj.currency ? ' ' + proj.currency : ''} | Net: ${bal >= 0 ? "+" : ""}${bal.toFixed(2)}\n`;
        }

        const kb = new InlineKeyboard().text("❌ Close", cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        if (ctx.callbackQuery) await ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb });
        else await ctx.reply(msg, { parse_mode: "HTML", reply_markup: kb });
      }

      bot.callbackQuery(/^closeproj_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const projId = Number(ctx.match[1]);
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;
        const proj = await getProjectById(env.DB, projId);
        if (!proj) return;
        const { netBalances } = await calculateBalances(env.DB, projId);

        const unsettled = Object.values(netBalances).some(b => Math.abs(b) > 0.01);
        if (unsettled) {
          const kb = new InlineKeyboard().text("❌ Close", cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
          await ctx.editMessageText(
            `❌ <b>Cannot close ${proj.name}!</b>\n\nThere are still unsettled debts. Run /settle to see who needs to pay whom, and log payments with /pay.`,
            { parse_mode: "HTML", reply_markup: kb }
          );
          if (ctx.chat && cmdMsgId) {
            await deleteMessages(ctx, ctx.chat.id, [cmdMsgId]);
          }
          return;
        }

        await env.DB.prepare("UPDATE projects SET status = 'ended' WHERE id = ?").bind(projId).run();
        const kb = new InlineKeyboard().text("❌ Close", cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        await ctx.editMessageText(`🔒 <b>Project ${proj.name} is now officially closed and archived.</b>`, { parse_mode: "HTML", reply_markup: kb });
        if (ctx.chat && cmdMsgId) {
          await deleteMessages(ctx, ctx.chat.id, [cmdMsgId]);
        }
      });

      // --- DISMISSAL / CLEANUP HANDLERS ---
      bot.callbackQuery(/^canceldraft_(.+)$/, async (ctx) => {
        await ctx.answerCallbackQuery("Cancelled").catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        const toDelete: number[] = [];
        if (ctx.callbackQuery.message?.message_id) {
          toDelete.push(ctx.callbackQuery.message.message_id);
        }
        if (draft?.msgIds) {
          toDelete.push(...draft.msgIds);
        }
        await deleteDraft(env.DB, draftId);
        if (ctx.chat && toDelete.length > 0) {
          await deleteMessages(ctx, ctx.chat.id, toDelete);
        }
      });

      bot.callbackQuery(/^closeflow_([0-9_]+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const ids = ctx.match[1].split("_").map(Number).filter(n => n > 0);
        const currentMsgId = ctx.callbackQuery.message?.message_id;
        const toDelete = Array.from(new Set([currentMsgId, ...ids].filter((id): id is number => typeof id === "number" && id > 0)));
        if (ctx.chat && toDelete.length > 0) {
          await deleteMessages(ctx, ctx.chat.id, toDelete);
        }
      });

      bot.callbackQuery(/^closemsg$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        if (ctx.chat && ctx.callbackQuery.message?.message_id) {
          await deleteMessages(ctx, ctx.chat.id, [ctx.callbackQuery.message.message_id]);
        }
      });

      return webhookCallback(bot, "cloudflare-mod")(request);
    }
    return new Response("Bot is active.", { status: 200 });
  },
};