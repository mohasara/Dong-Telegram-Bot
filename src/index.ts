import { Bot, webhookCallback, InlineKeyboard, Keyboard, Context } from "grammy";

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
}

export const GROUP_COMMANDS = [
  { command: "new", description: "Create a new project" },
  { command: "add", description: "Record an expense (supports math: 5000+2000 Taxi)" },
  { command: "pay", description: "Record a repayment transfer" },
  { command: "balances", description: "View member balances & breakdown" },
  { command: "settle", description: "Optimal settlement plan (who pays whom)" },
  { command: "report", description: "Full group spending report" },
  { command: "projects", description: "List all active and closed projects" },
  { command: "delete", description: "Recent ledger & delete entries" },
  { command: "close", description: "Close & archive a settled project" },
  { command: "help", description: "How to use Dong Bot" },
];

export const pvKeyboard = new Keyboard()
  .text("👤 My Balances").text("📁 My Projects").row()
  .text("❓ Help & Guide")
  .resized()
  .persistent();

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

function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function deleteMessages(ctx: Context, chatId: number, messageIds: (number | undefined | null)[]) {
  const uniqueIds = Array.from(new Set(messageIds.filter((id): id is number => typeof id === 'number' && id > 0)));
  if (uniqueIds.length === 0) return;
  for (let i = 0; i < uniqueIds.length; i += 100) {
    const chunk = uniqueIds.slice(i, i + 100);
    try {
      await ctx.api.deleteMessages(chatId, chunk);
    } catch (_) {
      await Promise.all(chunk.map(async (msgId) => {
        try {
          await ctx.api.deleteMessage(chatId, msgId);
        } catch (_) {}
      }));
    }
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
  if (pos < expr.length || !isFinite(result)) return NaN;
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
  return txs.map(t => `💸 <b>${escapeHtml(names[t.from] || 'Unknown')}</b> ➔ <b>${escapeHtml(names[t.to] || 'Unknown')}</b>: ${t.amount.toFixed(2)}${currency ? ' ' + escapeHtml(currency) : ''}`);
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
    const url = new URL(request.url);
    if (url.pathname === "/setcommands") {
      const bot = new Bot(env.BOT_TOKEN);
      await bot.api.setMyCommands(GROUP_COMMANDS, { scope: { type: "all_group_chats" } });
      await bot.api.setMyCommands([{ command: "start", description: "Open bot menu" }], { scope: { type: "all_private_chats" } });
      return new Response("Commands registered for all_group_chats and configured for all_private_chats.", { status: 200 });
    }

    if (request.method === "POST") {
      const bot = new Bot(env.BOT_TOKEN);
      bot.catch((err) => {
        console.error("Unhandled error in bot handler:", err.error || err);
      });

      const createProjectAndFinish = async (ctx: Context, name: string, currency: string, draftId: string, msgIds: number[]) => {
        if (!ctx.chat) return;
        const proj = await env.DB.prepare("INSERT INTO projects (chat_id, name, currency) VALUES (?, ?, ?) RETURNING id").bind(ctx.chat.id, name, currency).first() as any;
        await env.DB.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, name) VALUES (?, ?, ?)").bind(proj.id, ctx.from!.id, ctx.from!.first_name).run();
        if (draftId) await deleteDraft(env.DB, draftId);

        const mainCmdId = msgIds.find(id => id > 0) || 0;
        const kb = new InlineKeyboard().text("✋ Join Project", mainCmdId ? `join_${proj.id}_${mainCmdId}` : `join_${proj.id}`).text("✅ Done Adding", mainCmdId ? `join_done_${proj.id}_${mainCmdId}` : `join_done_${proj.id}`);
        await ctx.reply(`🎉 Project <b>${escapeHtml(name)}</b>${currency ? ' (' + escapeHtml(currency) + ')' : ''} created!\n\n👥 <b>Current Members:</b> ${escapeHtml(ctx.from!.first_name)}\n\nTap <b>Join Project</b> below or reply with a name to add someone:\n\n<span class="tg-spoiler">[Action: project_join_${proj.id}_${mainCmdId}]</span>`, { parse_mode: "HTML", reply_markup: kb });

        if (msgIds.length > 0) {
          await deleteMessages(ctx, ctx.chat.id, msgIds);
        }
      };

      const processNew = async (ctx: Context, args: string[], initialMsgIds: number[] = []) => {
        if (!ctx.chat) return;
        if (!args || args.length === 0) return ctx.reply("❌ Missing project name.");
        let name = args[0];
        let currency = "";
        if (args.length === 2) {
          currency = args[1];
        } else if (args.length > 2) {
          const last = args[args.length - 1];
          if (/^[$€£¥﷼]|^(USD|EUR|GBP|IRR|TOMAN|CAD|AUD)$/i.test(last)) {
            name = args.slice(0, -1).join(" ");
            currency = last;
          } else {
            name = args.join(" ");
          }
        }
        await createProjectAndFinish(ctx, name, currency, "", initialMsgIds);
      };

      const promptAddDescription = async (ctx: Context, db: D1Database, draftId: string, draft: any) => {
        const promptText = draft.isItemized
          ? `⚡ <b>Unequal Expense</b> (Total will be calculated from individual shares)\n\nReply to this message with an optional <b>Description</b> (e.g. <code>Taxi</code>, <code>Dinner</code>), or send <code>-</code> to skip:\n\n<span class="tg-spoiler">[Action: add_step2_${draftId}]</span>`
          : `Amount: <b>${draft.amount}</b>\n\nReply to this message with an optional <b>Description</b> (e.g. <code>Taxi</code>, <code>Dinner</code>), or send <code>-</code> to skip:\n\n<span class="tg-spoiler">[Action: add_step2_${draftId}]</span>`;

        const replyToId = ctx.message?.message_id || ctx.callbackQuery?.message?.message_id;
        const promptMsg = await ctx.reply(promptText, {
          parse_mode: "HTML",
          reply_parameters: replyToId ? { message_id: replyToId } : undefined,
          reply_markup: {
            force_reply: true,
            input_field_placeholder: "Description or send - to skip"
          }
        });
        draft.msgIds = Array.from(new Set([...(draft.msgIds || []), promptMsg.message_id]));
        await saveDraft(db, draftId, draft);
      };

      const startAddPayerFlow = async (ctx: Context, draftId: string, draft: any) => {
        const { projectId } = await routeProjectCommand(ctx, env.DB, "add", draftId);
        draft.projectId = projectId;
        draft.payerId = null;
        draft.splitWith = [];
        await saveDraft(env.DB, draftId, draft);
        if (projectId) {
          await promptPayerSelection(ctx, env.DB, draftId, projectId, draft.amount, draft.desc, draft.isItemized);
        }
      };

      const processAdd = async (ctx: Context, args: string[], initialMsgIds: number[] = []) => {
        if (!ctx.chat) return;
        const raw = (args || []).join(" ");
        const { mathExpr, desc: parsedDesc } = parseMathInput(raw);
        if (!mathExpr) return ctx.reply("❌ Missing expense amount.");
        const evaluated = safeEval(mathExpr);
        if (isNaN(evaluated) || !isFinite(evaluated) || evaluated <= 0) return ctx.reply(`❌ Invalid math or amount: '<code>${escapeHtml(mathExpr)}</code>'`, { parse_mode: "HTML" });
        const amount = Math.round(evaluated * 100) / 100;
        
        let desc = parsedDesc;
        if (!desc) {
          desc = new Date().toISOString().replace('T', ' ').substring(0, 16); 
        }

        const draftId = `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const draft = { amount, desc, projectId: null, payerId: null, splitWith: [], msgIds: initialMsgIds, step: "payer" };
        await saveDraft(env.DB, draftId, draft);
        await startAddPayerFlow(ctx, draftId, draft);
      };

      const processPay = async (ctx: Context, args: string[], initialMsgIds: number[] = []) => {
        if (!ctx.chat) return;
        const raw = (args || []).join(" ");
        const { mathExpr } = parseMathInput(raw);
        if (!mathExpr) return ctx.reply("❌ Missing payment amount.");
        const evaluated = safeEval(mathExpr);
        if (isNaN(evaluated) || !isFinite(evaluated) || evaluated <= 0) return ctx.reply(`❌ Invalid math or amount: '<code>${escapeHtml(mathExpr)}</code>'`, { parse_mode: "HTML" });
        const amount = Math.round(evaluated * 100) / 100;
        const draftId = `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const { projectId } = await routeProjectCommand(ctx, env.DB, "pay", draftId);
        await saveDraft(env.DB, draftId, { amount, projectId, fromId: null, toId: null, msgIds: initialMsgIds });
        if (projectId) await promptPaySender(ctx, env.DB, draftId, projectId, amount);
      };

      // ====================================================
      // 1. PRIVATE CHAT (PV) SCREENS & HANDLERS
      // ====================================================

      const showPrivateBalances = async (ctx: Context) => {
        if (!ctx.from) return;
        const userId = ctx.from.id;
        const { results: memberships } = await env.DB.prepare(
          "SELECT p.id, p.name, p.currency FROM project_members pm JOIN projects p ON pm.project_id = p.id WHERE pm.user_id = ? AND p.status = 'active'"
        ).bind(userId).all();

        if (!memberships || memberships.length === 0) {
          return ctx.reply("You are not part of any active projects yet.", { reply_markup: pvKeyboard });
        }

        let report = `👤 <b>Your Balances Across All Projects:</b>\n\n`;
        const kb = new InlineKeyboard();
        for (const proj of (memberships as any[])) {
          const { netBalances } = await calculateBalances(env.DB, proj.id);
          const bal = netBalances[userId] || 0;
          const icon = bal > 0.01 ? "🟢" : bal < -0.01 ? "🔴" : "⚪";
          report += `${icon} <b>${escapeHtml(proj.name)}:</b> ${bal >= 0 ? "+" : ""}${bal.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}\n`;
          kb.text(`📊 Breakdown: ${proj.name}`, `pv_proj_${proj.id}`).row();
        }
        report += `\n<i>Tap a project below to see who owes whom:</i>`;
        await ctx.reply(report, { parse_mode: "HTML", reply_markup: kb });
      };

      const showPrivateProjects = async (ctx: Context) => {
        if (!ctx.from) return;
        const userId = ctx.from.id;
        const { results: projects } = await env.DB.prepare(
          "SELECT p.id, p.name, p.currency, p.status, (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count FROM project_members pm JOIN projects p ON pm.project_id = p.id WHERE pm.user_id = ? ORDER BY p.id DESC LIMIT 10"
        ).bind(userId).all();

        if (!projects || projects.length === 0) {
          return ctx.reply("You have not joined any projects yet.", { reply_markup: pvKeyboard });
        }

        let msg = `📁 <b>Your Projects:</b>\n\n`;
        const kb = new InlineKeyboard();
        for (const p of (projects as any[])) {
          const icon = p.status === 'active' ? '🟢' : '🔒';
          msg += `${icon} <b>${escapeHtml(p.name)}</b>${p.currency ? ' (' + escapeHtml(p.currency) + ')' : ''}\n`;
          msg += `   👥 Members: ${p.member_count} | Status: <b>${p.status.toUpperCase()}</b>\n\n`;
          kb.text(`🔍 Details: ${p.name}`, `pv_proj_${p.id}`).row();
        }
        await ctx.reply(msg, { parse_mode: "HTML", reply_markup: kb });
      };

      const showPrivateHelp = async (ctx: Context) => {
        const msg = 
          `👋 <b>Dong Split Bot Guide</b>\n\n` +
          `<b>How to use in groups:</b>\n` +
          `1. Add me to your group.\n` +
          `2. Type <code>/new &lt;Name&gt; [Currency]</code> to create a project.\n` +
          `3. Group members tap <b>Join Project</b>.\n` +
          `4. Log expenses with <code>/add 5000 Taxi</code> (supports math: <code>2000+3000</code>).\n` +
          `5. Check balances anytime with <code>/balances</code> or <code>/settle</code>.\n` +
          `6. Record repayments with <code>/pay 1000</code>.\n` +
          `7. When all debts are zero, close the project with <code>/close</code>.\n\n` +
          `<i>In this private chat, you can tap the buttons below anytime to check your balances and projects!</i>`;
        await ctx.reply(msg, { parse_mode: "HTML", reply_markup: pvKeyboard });
      };

      bot.hears("👤 My Balances", async (ctx) => {
        if (ctx.chat?.type === "private") await showPrivateBalances(ctx);
      });

      bot.hears("📁 My Projects", async (ctx) => {
        if (ctx.chat?.type === "private") await showPrivateProjects(ctx);
      });

      bot.hears("❓ Help & Guide", async (ctx) => {
        if (ctx.chat?.type === "private") await showPrivateHelp(ctx);
      });

      bot.hears(/^(my\s*balance|balances|حساب)$/i, async (ctx) => {
        if (ctx.chat?.type === "private") await showPrivateBalances(ctx);
      });

      bot.hears(/^(projects|پروژه.*)$/i, async (ctx) => {
        if (ctx.chat?.type === "private") await showPrivateProjects(ctx);
      });

      bot.hears(/^(help|راهنما)$/i, async (ctx) => {
        if (ctx.chat?.type === "private") await showPrivateHelp(ctx);
      });

      // ====================================================
      // 2. COMMANDS
      // ====================================================

      bot.command("start", async (ctx) => {
        if (!ctx.chat) return;
        if (ctx.chat.type === "private") {
          return ctx.reply(
            `👋 <b>Welcome to Dong Split Bot!</b>\n\n` +
            `Here in private chat, you can check your debts, credits, and active projects across all your groups without using slash commands.\n\n` +
            `👇 <b>Tap a button below:</b>`,
            { parse_mode: "HTML", reply_markup: pvKeyboard }
          );
        }
        await ctx.reply("👋 Dong Bot is active!\n\nCreate a project with: <code>/new &lt;Name&gt; [Currency]</code>\nType /help to see all commands.", { parse_mode: "HTML" });
      });

      bot.command("help", async (ctx) => {
        if (!ctx.chat) return;
        if (ctx.chat.type === "private") return showPrivateHelp(ctx);
        const msg = 
          `📖 <b>Dong Split Bot Commands:</b>\n\n` +
          `• <code>/new &lt;Name&gt; [Currency]</code> — Create a new project\n` +
          `• <code>/add [amount] [desc]</code> — Record a new expense (supports math: <code>5000+2000 Taxi</code>)\n` +
          `• <code>/pay [amount]</code> — Record a transfer (supports math: <code>10000/2</code>)\n` +
          `• <code>/balances</code> — View member balances and breakdown\n` +
          `• <code>/settle</code> — Get optimal debt settlement plan\n` +
          `• <code>/report</code> — View full group spending report\n` +
          `• <code>/projects</code> — List all active and closed projects\n` +
          `• <code>/delete</code> — View recent ledger and delete entries\n` +
          `• <code>/close</code> — Close and archive a settled project\n` +
          `• <code>/mybalance</code> — Check your balances in private chat\n`;
        await ctx.reply(msg, { parse_mode: "HTML" });
      });

      bot.command("mybalance", async (ctx) => {
        if (!ctx.chat) return;
        if (ctx.chat.type !== "private") return ctx.reply("Use /balances inside your group, or use private chat.");
        await showPrivateBalances(ctx);
      });

      bot.command("new", async (ctx) => {
        if (!ctx.chat) return;
        if (ctx.chat.type === "private") return ctx.reply("Please use /new inside a group chat.");
        const cmdMsgId = ctx.message?.message_id || 0;
        const args = ctx.match.trim().split(/\s+/).filter(Boolean);
        if (args.length === 0) {
          const draftId = `new_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
          const promptMsg = await ctx.reply(
            `Reply to this message with your <b>Project Name</b> (e.g. <code>Party</code> or <code>Trip to Paris</code>):\n\n<span class="tg-spoiler">[Action: new_step1_${draftId}]</span>`,
            { parse_mode: "HTML", reply_parameters: cmdMsgId ? { message_id: cmdMsgId } : undefined, reply_markup: { force_reply: true, input_field_placeholder: "Project Name (e.g. Party)" } }
          );
          await saveDraft(env.DB, draftId, { step: "name", msgIds: Array.from(new Set([...(cmdMsgId ? [cmdMsgId] : []), promptMsg.message_id])) });
          return;
        }
        await processNew(ctx, args, cmdMsgId ? [cmdMsgId] : []);
      });

      bot.command("add", async (ctx) => {
        if (!ctx.chat) return;
        if (ctx.chat.type === "private") return ctx.reply("Use /add in your group.");
        const cmdMsgId = ctx.message?.message_id || 0;
        const args = ctx.match.trim().split(/\s+/).filter(Boolean);
        if (args.length === 0) {
          const draftId = `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
          const kb = new InlineKeyboard()
            .text("⚡ Unequal Share", `add_itemized_${draftId}`)
            .text("❌ Cancel", `canceldraft_${draftId}`);
          const optMsg = await ctx.reply(
            `<i>Don't know the total amount? Tap below:</i>`,
            { parse_mode: "HTML", reply_markup: kb }
          );
          const promptMsg = await ctx.reply(
            `Reply to this message with the <b>Expense Amount</b> (e.g. <code>50000</code> or <code>2000+3000</code>):\n\n<span class="tg-spoiler">[Action: add_step1_${draftId}]</span>`,
            {
              parse_mode: "HTML",
              reply_parameters: cmdMsgId ? { message_id: cmdMsgId } : undefined,
              reply_markup: { force_reply: true, input_field_placeholder: "Expense Amount (e.g. 50000)" }
            }
          );
          await saveDraft(env.DB, draftId, { step: "amount", msgIds: Array.from(new Set([...(cmdMsgId ? [cmdMsgId] : []), optMsg.message_id, promptMsg.message_id])) });
          return;
        }
        if (args[0].toLowerCase() === "unequal" || args[0].toLowerCase() === "itemized") {
          const desc = args.slice(1).join(" ").trim();
          const draftId = `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
          const draft = { isItemized: true, amount: 0, desc: desc || "", step: desc ? "payer" : "desc", msgIds: cmdMsgId ? [cmdMsgId] : [] };
          await saveDraft(env.DB, draftId, draft);
          if (desc) {
            return startAddPayerFlow(ctx, draftId, draft);
          } else {
            return promptAddDescription(ctx, env.DB, draftId, draft);
          }
        }
        await processAdd(ctx, args, cmdMsgId ? [cmdMsgId] : []);
      });

      bot.command("pay", async (ctx) => {
        if (!ctx.chat) return;
        if (ctx.chat.type === "private") return ctx.reply("Use /pay in your group.");
        const cmdMsgId = ctx.message?.message_id || 0;
        const args = ctx.match.trim().split(/\s+/).filter(Boolean);
        if (args.length === 0) {
          const draftId = `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
          const promptMsg = await ctx.reply(
            `Reply to this message with the amount you are transferring (e.g. <code>50000</code> or <code>10000/2</code>):\n\n<span class="tg-spoiler">[Action: pay_step1_${draftId}]</span>`,
            { parse_mode: "HTML", reply_parameters: cmdMsgId ? { message_id: cmdMsgId } : undefined, reply_markup: { force_reply: true, input_field_placeholder: "Transfer Amount (e.g. 50000)" } }
          );
          await saveDraft(env.DB, draftId, { step: "amount", msgIds: Array.from(new Set([...(cmdMsgId ? [cmdMsgId] : []), promptMsg.message_id])) });
          return;
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

        // Catch offline member additions by replying to the project invitation message
        const joinMatch = replyTo.text.match(/\[Action:\s*project_join_(\d+)(?:_(\d+))?\]/);
        if (joinMatch) {
          const projectId = Number(joinMatch[1]);
          const cmdMsgId = joinMatch[2] ? Number(joinMatch[2]) : 0;
          const proj = await getProjectById(env.DB, projectId);
          if (!proj || proj.status !== "active") return next();

          const names = ctx.message.text.trim().split(/[,،\n]+/).map(n => n.trim()).filter(Boolean);
          if (names.length === 0) return next();

          for (const rawName of names) {
            const cleanName = rawName.slice(0, 32);
            // Deduplicate members by name
            const existing = await env.DB.prepare("SELECT id FROM project_members WHERE project_id = ? AND LOWER(name) = LOWER(?)").bind(projectId, cleanName).first();
            if (existing) continue;

            const minRow = await env.DB.prepare("SELECT MIN(user_id) as min_id FROM project_members WHERE project_id = ? AND user_id < 0").bind(projectId).first() as any;
            const nextUserId = (minRow && typeof minRow.min_id === "number" && minRow.min_id < 0) ? minRow.min_id - 1 : -1;
            await env.DB.prepare("INSERT INTO project_members (project_id, user_id, name) VALUES (?, ?, ?)").bind(projectId, nextUserId, cleanName).run();
          }

          // Delete the user's name message so group stays clean
          if (ctx.chat) {
            await deleteMessages(ctx, ctx.chat.id, [ctx.message.message_id]);
          }

          // Update the project announcement message
          const members = await getProjectMembers(env.DB, projectId);
          const kb = new InlineKeyboard()
            .text("✋ Join Project", cmdMsgId ? `join_${projectId}_${cmdMsgId}` : `join_${projectId}`)
            .text("✅ Done Adding", cmdMsgId ? `join_done_${projectId}_${cmdMsgId}` : `join_done_${projectId}`);
          try {
            await ctx.api.editMessageText(
              ctx.chat.id,
              replyTo.message_id,
              `🎉 Project <b>${escapeHtml(proj.name)}</b>${proj.currency ? ' (' + escapeHtml(proj.currency) + ')' : ''} created!\n\n👥 <b>Current Members:</b> ${members.map(m => escapeHtml(m.name)).join(", ")}\n\nTap <b>Join Project</b> below or reply with a name to add someone:\n\n<span class="tg-spoiler">[Action: project_join_${projectId}_${cmdMsgId}]</span>`,
              { parse_mode: "HTML", reply_markup: kb }
            );
          } catch (_) {}
          return;
        }

        // --- Step-by-Step /new: Step 1 (Project Name) ---
        const newStep1Match = replyTo.text.match(/\[Action:\s*new_step1_([a-zA-Z0-9_]+)\]/);
        if (newStep1Match) {
          const draftId = newStep1Match[1];
          const draft = await getDraft(env.DB, draftId);
          if (!draft) return ctx.reply("❌ Session expired. Please run /new again.");

          const text = ctx.message.text.trim();
          if (!text) return ctx.reply("❌ Please provide a valid project name.");

          draft.msgIds = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id]));
          
          // Check if user already provided name and currency in this single reply
          const parts = text.split(/\s+/).filter(Boolean);
          if (parts.length > 1) {
            const last = parts[parts.length - 1];
            if (/^[$€£¥﷼]|^(USD|EUR|GBP|IRR|TOMAN|CAD|AUD)$/i.test(last)) {
              const name = parts.slice(0, -1).join(" ");
              const currency = last;
              await createProjectAndFinish(ctx, name, currency, draftId, draft.msgIds);
              return;
            }
          }

          draft.name = text;
          draft.step = "currency";
          await saveDraft(env.DB, draftId, draft);

          const prompt2 = await ctx.reply(
            `Project: <b>${escapeHtml(draft.name)}</b>\n\nReply to this message with a <b>Currency</b> (e.g. <code>$</code>, <code>€</code>, <code>Toman</code>), or send <code>-</code> to skip:\n\n<span class="tg-spoiler">[Action: new_step2_${draftId}]</span>`,
            {
              parse_mode: "HTML",
              reply_parameters: { message_id: ctx.message.message_id },
              reply_markup: { force_reply: true, input_field_placeholder: "Currency or send - to skip" }
            }
          );
          draft.msgIds.push(prompt2.message_id);
          await saveDraft(env.DB, draftId, draft);
          return;
        }

        // --- Step-by-Step /new: Step 2 (Currency) ---
        const newStep2Match = replyTo.text.match(/\[Action:\s*new_step2_([a-zA-Z0-9_]+)\]/);
        if (newStep2Match) {
          const draftId = newStep2Match[1];
          const draft = await getDraft(env.DB, draftId);
          if (!draft) return ctx.reply("❌ Session expired. Please run /new again.");

          let currency = ctx.message.text.trim();
          if (currency === "-" || currency.toLowerCase() === "skip" || currency.toLowerCase() === "none" || currency === ".") {
            currency = "";
          }
          draft.msgIds = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id]));
          await createProjectAndFinish(ctx, draft.name, currency, draftId, draft.msgIds);
          return;
        }

        // --- Step-by-Step /add: Step 1 (Amount) ---
        const addStep1Match = replyTo.text.match(/\[Action:\s*add_step1_([a-zA-Z0-9_]+)\]/);
        if (addStep1Match) {
          const draftId = addStep1Match[1];
          const draft = await getDraft(env.DB, draftId);
          if (!draft) return ctx.reply("❌ Session expired. Please run /add again.");

          const raw = ctx.message.text.trim();
          if (raw.toLowerCase() === "unequal" || raw.toLowerCase() === "itemized" || raw === "-" || raw.toLowerCase() === "skip") {
            draft.isItemized = true;
            draft.amount = 0;
            draft.step = "desc";
            draft.msgIds = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id]));
            await saveDraft(env.DB, draftId, draft);
            return promptAddDescription(ctx, env.DB, draftId, draft);
          }
          const { mathExpr, desc: parsedDesc } = parseMathInput(raw);
          if (!mathExpr) return ctx.reply("❌ Missing expense amount. Please reply with an amount (e.g. <code>50000</code> or <code>2000+3000</code>):", { parse_mode: "HTML" });
          const evaluated = safeEval(mathExpr);
          if (isNaN(evaluated) || !isFinite(evaluated) || evaluated <= 0) {
            return ctx.reply(`❌ Invalid math or amount: '<code>${escapeHtml(mathExpr)}</code>'`, { parse_mode: "HTML" });
          }
          const amount = Math.round(evaluated * 100) / 100;
          draft.amount = amount;
          draft.msgIds = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id]));

          if (parsedDesc) {
            draft.desc = parsedDesc;
            draft.step = "payer";
            await saveDraft(env.DB, draftId, draft);
            return startAddPayerFlow(ctx, draftId, draft);
          }

          draft.step = "desc";
          await saveDraft(env.DB, draftId, draft);
          return promptAddDescription(ctx, env.DB, draftId, draft);
        }

        // --- Step-by-Step /add: Step 2 (Description) ---
        const addStep2Match = replyTo.text.match(/\[Action:\s*add_step2_([a-zA-Z0-9_]+)\]/);
        if (addStep2Match) {
          const draftId = addStep2Match[1];
          const draft = await getDraft(env.DB, draftId);
          if (!draft) return ctx.reply("❌ Session expired. Please run /add again.");

          let desc = ctx.message.text.trim();
          if (!desc || desc === "-" || desc.toLowerCase() === "skip" || desc.toLowerCase() === "none" || desc === ".") {
            desc = new Date().toISOString().replace('T', ' ').substring(0, 16);
          }
          draft.desc = desc;
          draft.msgIds = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id]));
          draft.step = "payer";
          await saveDraft(env.DB, draftId, draft);
          return startAddPayerFlow(ctx, draftId, draft);
        }

        // --- Step-by-Step /pay: Step 1 (Amount) ---
        const payStep1Match = replyTo.text.match(/\[Action:\s*pay_step1_([a-zA-Z0-9_]+)\]/);
        if (payStep1Match) {
          const draftId = payStep1Match[1];
          const draft = await getDraft(env.DB, draftId);
          if (!draft) return ctx.reply("❌ Session expired. Please run /pay again.");

          const raw = ctx.message.text.trim();
          const { mathExpr } = parseMathInput(raw);
          if (!mathExpr) return ctx.reply("❌ Missing payment amount. Please reply with an amount (e.g. <code>50000</code> or <code>10000/2</code>):", { parse_mode: "HTML" });
          const evaluated = safeEval(mathExpr);
          if (isNaN(evaluated) || !isFinite(evaluated) || evaluated <= 0) {
            return ctx.reply(`❌ Invalid math or amount: '<code>${escapeHtml(mathExpr)}</code>'`, { parse_mode: "HTML" });
          }
          const amount = Math.round(evaluated * 100) / 100;
          draft.amount = amount;
          draft.msgIds = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id]));

          const { projectId } = await routeProjectCommand(ctx, env.DB, "pay", draftId);
          draft.projectId = projectId;
          draft.fromId = null;
          draft.toId = null;
          await saveDraft(env.DB, draftId, draft);
          if (projectId) await promptPaySender(ctx, env.DB, draftId, projectId, amount);
          return;
        }

        // Catch legacy missing argument prompts (if any)
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

        // --- Step-by-Step Unequal Split: Individual Shares ---
        const splitStepMatch = replyTo.text.match(/\[Action:\s*split_step_([a-zA-Z0-9_]+)\]/);
        if (splitStepMatch) {
          const draftId = splitStepMatch[1];
          const draft = await getDraft(env.DB, draftId);
          if (!draft || !draft.splitOrder) return ctx.reply("❌ Session expired. Please start over with /add.");

          const raw = ctx.message.text.trim();
          if (raw.toLowerCase() === "cancel" || raw.toLowerCase() === "/cancel") {
            await deleteDraft(env.DB, draftId);
            const toDelete = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id])).filter((id): id is number => typeof id === "number" && id > 0);
            if (ctx.chat && toDelete.length > 0) {
              await deleteMessages(ctx, ctx.chat.id, toDelete);
            }
            return ctx.reply("❌ Expense cancelled.");
          }

          const { mathExpr } = parseMathInput(raw);
          const amt = safeEval(mathExpr || raw);
          if (isNaN(amt) || !isFinite(amt) || amt < 0) {
            const members = await getProjectMembers(env.DB, draft.projectId);
            const curMember = members.find(m => m.user_id === draft.splitOrder[draft.currentShareIndex]);
            const curName = curMember?.name || "this person";
            const errPrompt = await ctx.reply(
              `❌ Invalid amount: '<code>${escapeHtml(raw)}</code>'\n\nPlease reply with a valid number or 0 for <b>${escapeHtml(curName)}</b>:\n\n<span class="tg-spoiler">[Action: split_step_${draftId}]</span>`,
              {
                parse_mode: "HTML",
                reply_parameters: { message_id: ctx.message.message_id },
                reply_markup: { force_reply: true, input_field_placeholder: `Share for ${curName.slice(0, 30)}` }
              }
            );
            draft.msgIds = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id, errPrompt.message_id]));
            await saveDraft(env.DB, draftId, draft);
            return;
          }

          const roundedAmt = Math.round(amt * 100) / 100;
          const currentUserId = draft.splitOrder[draft.currentShareIndex];

          // If fixed total is known, validate user didn't exceed remaining
          if (!draft.isItemized && draft.amount > 0) {
            let allocatedSoFar = 0;
            for (let i = 0; i < draft.currentShareIndex; i++) {
              allocatedSoFar += (draft.shares?.[draft.splitOrder[i]] || 0);
            }
            allocatedSoFar = Math.round(allocatedSoFar * 100) / 100;
            const remaining = Math.round((draft.amount - allocatedSoFar) * 100) / 100;

            if (roundedAmt > remaining + 0.01) {
              const members = await getProjectMembers(env.DB, draft.projectId);
              const curMember = members.find(m => m.user_id === currentUserId);
              const curName = curMember?.name || "this person";
              const rem = Math.max(0, remaining);
              const errPrompt = await ctx.reply(
                `⚠️ <b>Amount exceeds remaining balance!</b>\n\nYou entered <b>${roundedAmt}</b>, but only <b>${rem}</b> is remaining (Total: <b>${draft.amount}</b>).\n\nPlease reply with an amount up to <b>${rem}</b> (or send <code>${rem}</code> to balance):`,
                {
                  parse_mode: "HTML",
                  reply_parameters: { message_id: ctx.message.message_id },
                  reply_markup: { force_reply: true, input_field_placeholder: `${rem}` }
                }
              );
              draft.msgIds = Array.from(new Set([...(draft.msgIds || []), ctx.message.message_id, errPrompt.message_id]));
              await saveDraft(env.DB, draftId, draft);
              return;
            }
          }

          if (!draft.shares) draft.shares = {};
          draft.shares[currentUserId] = roundedAmt;
          draft.msgIds = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id]));
          draft.currentShareIndex = (draft.currentShareIndex || 0) + 1;

          // Check if fixed total has been completely reached early
          if (!draft.isItemized && draft.amount > 0) {
            let totalAllocated = 0;
            for (let i = 0; i < draft.currentShareIndex; i++) {
              totalAllocated += (draft.shares[draft.splitOrder[i]] || 0);
            }
            totalAllocated = Math.round(totalAllocated * 100) / 100;

            if (Math.abs(totalAllocated - draft.amount) <= 0.01) {
              // Automatically set all remaining members' shares to 0
              for (let k = draft.currentShareIndex; k < draft.splitOrder.length; k++) {
                const remUid = draft.splitOrder[k];
                draft.shares[remUid] = 0;
              }
              draft.currentShareIndex = draft.splitOrder.length;
            }
          }

          if (draft.currentShareIndex < draft.splitOrder.length) {
            await saveDraft(env.DB, draftId, draft);
            return promptNextShare(ctx, env.DB, draftId, draft);
          }

          // All members completed!
          const members = await getProjectMembers(env.DB, draft.projectId);
          const userShares: { userId: number; amount: number; name: string }[] = [];
          let totalSum = 0;

          for (const uid of draft.splitOrder) {
            const sAmt = draft.shares[uid] || 0;
            const member = members.find(m => m.user_id === uid);
            userShares.push({ userId: uid, amount: sAmt, name: member?.name || "Unknown" });
            totalSum += sAmt;
          }
          totalSum = Math.round(totalSum * 100) / 100;

          if (draft.isItemized) {
            if (totalSum <= 0) {
              await deleteDraft(env.DB, draftId);
              return ctx.reply("❌ Total expense amount is 0. Expense cancelled.");
            }
            draft.amount = totalSum;
          } else {
            if (Math.abs(totalSum - draft.amount) > 0.01) {
              await saveDraft(env.DB, draftId, draft);
              const diff = Math.round((draft.amount - totalSum) * 100) / 100;
              const kb = new InlineKeyboard()
                .text(`✅ Set Total to ${totalSum}`, `exp_fixsum_${draftId}_${totalSum}`)
                .row()
                .text("🔄 Restart Shares", `expunequal_${draftId}`)
                .text("❌ Cancel", `canceldraft_${draftId}`);
              return ctx.reply(
                `⚠️ <b>Total Mismatch!</b>\n\nYour inputs sum to <b>${totalSum}</b>, but expense total was set to <b>${draft.amount}</b> (difference: <b>${diff > 0 ? "+" : ""}${diff}</b>).\n\nTap below to use <b>${totalSum}</b> as total, or restart:`,
                { parse_mode: "HTML", reply_markup: kb }
              );
            }
          }

          return finalizeUnequalExpense(ctx, env.DB, draftId, draft, userShares);
        }

        return next();
      });

      // ====================================================
      // 3. CALLBACK QUERY HANDLERS (BUTTON CLICKS)
      // ====================================================

      bot.callbackQuery(/^join_(\d+)(?:_(\d+))?$/, async (ctx) => {
        const projectId = Number(ctx.match[1]);
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;
        await env.DB.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, name) VALUES (?, ?, ?)").bind(projectId, ctx.from.id, ctx.from.first_name).run();
        const members = await getProjectMembers(env.DB, projectId);
        const proj = await getProjectById(env.DB, projectId);
        if (proj) {
          const kb = new InlineKeyboard()
            .text("✋ Join Project", cmdMsgId ? `join_${projectId}_${cmdMsgId}` : `join_${projectId}`)
            .text("✅ Done Adding", cmdMsgId ? `join_done_${projectId}_${cmdMsgId}` : `join_done_${projectId}`);
          try {
            await ctx.editMessageText(
              `🎉 Project <b>${escapeHtml(proj.name)}</b>${proj.currency ? ' (' + escapeHtml(proj.currency) + ')' : ''} created!\n\n👥 <b>Current Members:</b> ${members.map(m => escapeHtml(m.name)).join(", ")}\n\nTap <b>Join Project</b> below or reply with a name to add someone:\n\n<span class="tg-spoiler">[Action: project_join_${projectId}_${cmdMsgId}]</span>`,
              { parse_mode: "HTML", reply_markup: kb }
            );
          } catch (_) {}
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

      // --- STEP-BY-STEP SKIP HANDLERS ---
      bot.callbackQuery(/^new_skip_curr_([a-zA-Z0-9_]+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        await createProjectAndFinish(ctx, draft.name, "", draftId, draft.msgIds || []);
      });

      bot.callbackQuery(/^add_skip_desc_([a-zA-Z0-9_]+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        draft.desc = new Date().toISOString().replace('T', ' ').substring(0, 16);
        draft.step = "payer";
        await saveDraft(env.DB, draftId, draft);
        return startAddPayerFlow(ctx, draftId, draft);
      });

      bot.callbackQuery(/^add_itemized_(exp_.+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return ctx.reply("❌ Session expired. Please run /add again.");

        draft.isItemized = true;
        draft.amount = 0;
        draft.step = "desc";
        await saveDraft(env.DB, draftId, draft);

        try {
          await ctx.editMessageText("⚡ <b>Unequal Share Mode</b> (Total will be calculated from individual shares)", { parse_mode: "HTML" });
        } catch (_) {}

        return promptAddDescription(ctx, env.DB, draftId, draft);
      });

      // --- ADD EXPENSE CALLBACKS ---
      bot.callbackQuery(/^selproj_add_(\d+)_(exp_.+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[2];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        draft.projectId = Number(ctx.match[1]);
        await saveDraft(env.DB, draftId, draft);
        await promptPayerSelection(ctx, env.DB, draftId, draft.projectId, draft.amount, draft.desc, draft.isItemized);
      });

      bot.callbackQuery(/^exppayer_(exp_.+)_(-?\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        draft.payerId = Number(ctx.match[2]);
        draft.splitWith = (await getProjectMembers(env.DB, draft.projectId)).map(m => m.user_id);
        await saveDraft(env.DB, draftId, draft);
        await renderSplitSelection(ctx, env.DB, draftId, draft);
      });

      async function promptPayerSelection(ctx: Context, db: D1Database, draftId: string, projId: number, amount: number, desc: string, isItemized: boolean = false) {
        const members = await getProjectMembers(db, projId);
        if (members.length === 0) {
          const text = `❌ <b>No members in this project yet!</b>\nUse /new or tap Join Project first.`;
          const kb = new InlineKeyboard().text("❌ Cancel", `canceldraft_${draftId}`);
          if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
          else {
            const sent = await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
            const d = await getDraft(db, draftId);
            if (d) {
              d.msgIds = Array.from(new Set([...(d.msgIds || []), sent.message_id]));
              await saveDraft(db, draftId, d);
            }
          }
          return;
        }
        const kb = new InlineKeyboard();
        for (let i = 0; i < members.length; i++) {
          kb.text(members[i].name, `exppayer_${draftId}_${members[i].user_id}`);
          if (i % 2 === 1) kb.row();
        }
        if (members.length % 2 !== 0) kb.row();
        kb.text("❌ Cancel", `canceldraft_${draftId}`);

        const amountLabel = isItemized ? "(⚡ Unequal Share)" : `(${amount})`;
        const text = `🧾 <b>${escapeHtml(desc)}</b> ${amountLabel}\n👉 <b>Who paid?</b>`;
        if (ctx.callbackQuery) {
          await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
        } else {
          const sent = await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
          const d = await getDraft(db, draftId);
          if (d) {
            d.msgIds = Array.from(new Set([...(d.msgIds || []), sent.message_id]));
            await saveDraft(db, draftId, d);
          }
        }
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

        if (draft.isItemized) {
          kb.text("⚡ Enter Shares ➡️", `expunequal_${draftId}`).row();
        } else {
          kb.text("⚡ Unequal Split", `expunequal_${draftId}`).text("💾 Confirm Equal", `expconfirm_${draftId}`).row();
        }
        kb.text("❌ Cancel", `canceldraft_${draftId}`);

        const header = draft.isItemized
          ? `🧾 <b>${escapeHtml(draft.desc)}</b> (⚡ Unequal Share)\n<i>Select who shares this expense, then enter individual shares:</i>`
          : `🧾 <b>${escapeHtml(draft.desc)}</b> (${draft.amount})\n<i>Toggle who shares this equally, or choose Unequal:</i>`;

        if (ctx.callbackQuery) {
          await ctx.editMessageText(header, { parse_mode: "HTML", reply_markup: kb });
        } else {
          const sent = await ctx.reply(header, { parse_mode: "HTML", reply_markup: kb });
          draft.msgIds = Array.from(new Set([...(draft.msgIds || []), sent.message_id]));
          await saveDraft(db, draftId, draft);
        }
      }

      bot.callbackQuery(/^exptoggle_(exp_.+)_(-?\d+)$/, async (ctx) => {
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
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        if (draft.isItemized || !draft.amount || draft.amount <= 0) {
          await ctx.answerCallbackQuery("Please use Unequal Split to enter shares!").catch(() => {});
          return;
        }
        if (!draft.splitWith || draft.splitWith.length === 0) {
          await ctx.answerCallbackQuery("Select at least 1 person!").catch(() => {});
          return;
        }
        await ctx.answerCallbackQuery().catch(() => {});
        const share = draft.amount / draft.splitWith.length;
        const exp = await env.DB.prepare("INSERT INTO expenses (project_id, payer_id, amount, description) VALUES (?, ?, ?, ?) RETURNING id").bind(draft.projectId, draft.payerId, draft.amount, draft.desc).first() as any;
        for (const uid of draft.splitWith) await env.DB.prepare("INSERT INTO expense_splits (expense_id, user_id, share_amount) VALUES (?, ?, ?)").bind(exp.id, uid, share).run();
        
        await deleteDraft(env.DB, draftId);
        const currentMsgId = ctx.callbackQuery?.message?.message_id;
        const toDelete = (draft.msgIds || []).filter((id: any): id is number => typeof id === "number" && id > 0 && id !== currentMsgId);
        const kb = new InlineKeyboard()
          .text("↩️ Undo", `delexp_${exp.id}_${draft.projectId}`)
          .text("❌ Close", "closemsg");
        await ctx.editMessageText(`✅ <b>Expense Saved!</b>\n🧾 <b>${escapeHtml(draft.desc)}</b> (${draft.amount})\n\n<i>Split equally between ${draft.splitWith.length} people.</i>`, { parse_mode: "HTML", reply_markup: kb });

        // Delete previous messages of this flow after showing the last message
        if (ctx.chat && toDelete.length > 0) {
          await deleteMessages(ctx, ctx.chat.id, toDelete);
        }
      });

      bot.callbackQuery(/^expunequal_(exp_.+)$/, async (ctx) => {
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;

        const members = await getProjectMembers(env.DB, draft.projectId);
        const activeMembers = members.filter(m => draft.splitWith.includes(m.user_id));
        if (activeMembers.length === 0) {
          await ctx.answerCallbackQuery("Select at least 1 person!").catch(() => {});
          return;
        }
        await ctx.answerCallbackQuery().catch(() => {});

        draft.splitOrder = activeMembers.map(m => m.user_id);
        draft.shares = {};
        draft.currentShareIndex = 0;
        draft.step = "split_step";

        const menuMsgId = ctx.callbackQuery.message?.message_id;
        if (menuMsgId) {
          draft.msgIds = Array.from(new Set([...(draft.msgIds || []), menuMsgId]));
        }
        await saveDraft(env.DB, draftId, draft);

        try {
          await ctx.editMessageText("⚡ <i>Entering unequal shares below...</i>", { parse_mode: "HTML" });
        } catch (_) {}

        await promptNextShare(ctx, env.DB, draftId, draft);
      });

      async function promptNextShare(ctx: Context, db: D1Database, draftId: string, draft: any) {
        const members = await getProjectMembers(db, draft.projectId);
        const currentUserId = draft.splitOrder[draft.currentShareIndex];
        const member = members.find(m => m.user_id === currentUserId);
        const memberName = member?.name || "Unknown";

        let allocatedSum = 0;
        for (let i = 0; i < draft.currentShareIndex; i++) {
          const uid = draft.splitOrder[i];
          allocatedSum += (draft.shares?.[uid] || 0);
        }
        allocatedSum = Math.round(allocatedSum * 100) / 100;

        let progress = "";
        for (let i = 0; i < draft.splitOrder.length; i++) {
          const uid = draft.splitOrder[i];
          const m = members.find(mem => mem.user_id === uid);
          const name = m?.name || "Unknown";
          if (i < draft.currentShareIndex) {
            progress += `• ${escapeHtml(name)}: <b>${draft.shares?.[uid] ?? 0}</b>\n`;
          } else if (i === draft.currentShareIndex) {
            progress += `👉 <b>${escapeHtml(name)}:</b> <i>(awaiting reply...)</i>\n`;
          } else {
            progress += `• ${escapeHtml(name)}: ⏳\n`;
          }
        }

        let status = "";
        let placeholder = `Share for ${memberName.slice(0, 30)}`;
        if (draft.isItemized) {
          status = allocatedSum > 0 ? `\n💰 <b>Current Total:</b> ${allocatedSum}` : "";
        } else {
          const remaining = Math.round((draft.amount - allocatedSum) * 100) / 100;
          status = `\n💰 <b>Allocated:</b> ${allocatedSum} | <b>Remaining:</b> ${remaining} (Total: ${draft.amount})`;
          if (draft.currentShareIndex === draft.splitOrder.length - 1 && remaining > 0) {
            placeholder = `${remaining}`;
          }
        }

        const promptText = 
          `⚡ <b>Unequal Split:</b> ${escapeHtml(draft.desc)}\n` +
          `Step <b>${draft.currentShareIndex + 1}</b> of <b>${draft.splitOrder.length}</b>\n\n` +
          progress +
          status + `\n\n` +
          `Reply with <b>${escapeHtml(memberName)}&#39;s share</b> (supports math like <code>2000+500</code> or <code>0</code>):\n\n` +
          `<span class="tg-spoiler">[Action: split_step_${draftId}]</span>`;

        const replyToId = ctx.message?.message_id || ctx.callbackQuery?.message?.message_id;
        const promptMsg = await ctx.reply(promptText, {
          parse_mode: "HTML",
          reply_parameters: replyToId ? { message_id: replyToId } : undefined,
          reply_markup: {
            force_reply: true,
            input_field_placeholder: placeholder
          }
        });
        draft.msgIds = Array.from(new Set([...(draft.msgIds || []), promptMsg.message_id]));
        await saveDraft(db, draftId, draft);
      }

      async function finalizeUnequalExpense(
        ctx: Context,
        db: D1Database,
        draftId: string,
        draft: any,
        userShares: { userId: number; amount: number; name: string }[]
      ) {
        const desc = draft.desc || new Date().toISOString().replace('T', ' ').substring(0, 16);
        const exp = await db.prepare(
          "INSERT INTO expenses (project_id, payer_id, amount, description) VALUES (?, ?, ?, ?) RETURNING id"
        ).bind(draft.projectId, draft.payerId, draft.amount, desc).first() as any;

        for (const s of userShares) {
          await db.prepare(
            "INSERT INTO expense_splits (expense_id, user_id, share_amount) VALUES (?, ?, ?)"
          ).bind(exp.id, s.userId, s.amount).run();
        }

        const kb = new InlineKeyboard()
          .text("↩️ Undo", `delexp_${exp.id}_${draft.projectId}`)
          .text("❌ Close", "closemsg");

        let reportMsg = `✅ <b>Unequal Expense Saved!</b>\n🧾 <b>${escapeHtml(desc)}</b> (${draft.amount})\n\n`;
        userShares.forEach(s => reportMsg += `• ${escapeHtml(s.name)}: ${s.amount}\n`);

        await ctx.reply(reportMsg, { parse_mode: "HTML", reply_markup: kb });
        await deleteDraft(db, draftId);

        const allIds = Array.from(new Set([
          ...(draft.msgIds || []),
          ctx.message?.message_id,
          ctx.callbackQuery?.message?.message_id
        ])).filter((id): id is number => typeof id === "number" && id > 0);

        if (ctx.chat && allIds.length > 0) {
          await deleteMessages(ctx, ctx.chat.id, allIds);
        }
      }

      bot.callbackQuery(/^exp_fixsum_(exp_.+)_([0-9.]+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const newTotal = Number(ctx.match[2]);
        const draft = await getDraft(env.DB, draftId);
        if (!draft || !draft.splitOrder || !draft.shares) return ctx.reply("❌ Session expired.");

        draft.amount = newTotal;
        const members = await getProjectMembers(env.DB, draft.projectId);
        const userShares = draft.splitOrder.map((uid: number) => ({
          userId: uid,
          amount: draft.shares[uid] || 0,
          name: members.find(m => m.user_id === uid)?.name || "Unknown"
        }));

        return finalizeUnequalExpense(ctx, env.DB, draftId, draft, userShares);
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

      bot.callbackQuery(/^payfrom_(pay_.+)_(-?\d+)$/, async (ctx) => {
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

      bot.callbackQuery(/^payto_(pay_.+)_(-?\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        const t = await env.DB.prepare("INSERT INTO settlements (project_id, from_user_id, to_user_id, amount) VALUES (?, ?, ?, ?) RETURNING id").bind(draft.projectId, draft.fromId, Number(ctx.match[2]), draft.amount).first() as any;
        await deleteDraft(env.DB, draftId);
        const currentMsgId = ctx.callbackQuery?.message?.message_id;
        const toDelete = (draft.msgIds || []).filter((id: any): id is number => typeof id === "number" && id > 0 && id !== currentMsgId);
        const kb = new InlineKeyboard()
          .text("↩️ Undo", `delpay_${t.id}_${draft.projectId}`)
          .text("❌ Close", "closemsg");
        await ctx.editMessageText(`✅ <b>Payment Recorded!</b>\nAmount: ${draft.amount}`, { parse_mode: "HTML", reply_markup: kb });

        // Delete original command and prompts at the end of the payment flow
        if (ctx.chat && toDelete.length > 0) {
          await deleteMessages(ctx, ctx.chat.id, toDelete);
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
          const text = `📊 <b>Balances for ${escapeHtml(proj.name)}:</b>\nNo members in this project yet.`;
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

        const text = `📊 <b>Balances for ${escapeHtml(proj.name)}:</b>\nTap a member below to see their detailed breakdown:`;
        if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
        else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
      }

      bot.callbackQuery(/^baluser_(\d+)_(-?\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const projId = Number(ctx.match[1]);
        const userId = Number(ctx.match[2]);
        const cmdMsgId = ctx.match[3] ? Number(ctx.match[3]) : 0;
        const proj = await getProjectById(env.DB, projId);
        if (!proj) return;
        const { netBalances, names, totalPaid, totalShare } = await calculateBalances(env.DB, projId);
        const myBal = netBalances[userId] || 0;
        const myName = names[userId] || "Member";
        
        let msg = `👤 <b>Balance Breakdown for ${escapeHtml(myName)}</b> (${escapeHtml(proj.name)})\n\n`;
        const transactions = getSettlementTransactions(netBalances);
        const myDebts = transactions.filter(t => t.from === userId);
        const myCredits = transactions.filter(t => t.to === userId);

        if (myDebts.length > 0 || myCredits.length > 0) {
          msg += `🧾 <b>Actionable Debts:</b>\n`;
          myDebts.forEach(d => msg += `🔴 Owes <b>${d.amount.toFixed(2)}</b> to ${escapeHtml(names[d.to] || 'Unknown')}\n`);
          myCredits.forEach(c => msg += `🟢 Gets <b>${c.amount.toFixed(2)}</b> from ${escapeHtml(names[c.from] || 'Unknown')}\n`);
          msg += `\n`;
        } else {
          msg += `✅ <b>No pending debts!</b>\n\n`;
        }

        msg += `💰 <b>Total Paid Out:</b> ${totalPaid[userId]?.toFixed(2) || '0.00'}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}\n`;
        msg += `🍽️ <b>Total Consumed:</b> ${totalShare[userId]?.toFixed(2) || '0.00'}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}\n`;
        msg += `------------------------------------\n`;
        if (myBal > 0.01) msg += `🟢 <b>Overall Total:</b> Gets back <b>+${myBal.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}</b>`;
        else if (myBal < -0.01) msg += `🔴 <b>Overall Total:</b> Owes <b>${myBal.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}</b>`;
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
        let report = `⚖️ <b>Optimal Settlement Plan for ${escapeHtml(proj.name)}:</b>\n\n`;
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

        let msg = `📈 <b>Full Report: ${escapeHtml(proj.name)}</b> (${escapeHtml(proj.status.toUpperCase())})\n\n`;
        msg += `💵 <b>Total Expenses:</b> ${totalExp.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''} (${countExp} entries)\n\n`;
        msg += `👥 <b>Individual Spending:</b>\n`;
        
        for (const m of members) {
          const paid = totalPaid[m.user_id] || 0;
          const bal = netBalances[m.user_id] || 0;
          msg += `• <b>${escapeHtml(m.name)}:</b> Paid ${paid.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''} | Net: ${bal >= 0 ? "+" : ""}${bal.toFixed(2)}\n`;
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
            `❌ <b>Cannot close ${escapeHtml(proj.name)}!</b>\n\nThere are still unsettled debts. Run /settle to see who needs to pay whom, and log payments with /pay.`,
            { parse_mode: "HTML", reply_markup: kb }
          );
          if (ctx.chat && cmdMsgId) {
            await deleteMessages(ctx, ctx.chat.id, [cmdMsgId]);
          }
          return;
        }

        await env.DB.prepare("UPDATE projects SET status = 'ended' WHERE id = ?").bind(projId).run();
        const kb = new InlineKeyboard().text("❌ Close", cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        await ctx.editMessageText(`🔒 <b>Project ${escapeHtml(proj.name)} is now officially closed and archived.</b>`, { parse_mode: "HTML", reply_markup: kb });
        if (ctx.chat && cmdMsgId) {
          await deleteMessages(ctx, ctx.chat.id, [cmdMsgId]);
        }
      });

      // --- PRIVATE CHAT (PV) NAVIGATION CALLBACKS ---
      bot.callbackQuery(/^pv_proj_(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const projId = Number(ctx.match[1]);
        const proj = await getProjectById(env.DB, projId);
        if (!proj) return;
        const userId = ctx.from.id;
        const { netBalances, names, totalPaid, totalShare } = await calculateBalances(env.DB, projId);
        const myBal = netBalances[userId] || 0;

        let msg = `📁 <b>${escapeHtml(proj.name)}</b> (${proj.status.toUpperCase()})\n\n`;
        const transactions = getSettlementTransactions(netBalances);
        const myDebts = transactions.filter(t => t.from === userId);
        const myCredits = transactions.filter(t => t.to === userId);

        if (myDebts.length > 0 || myCredits.length > 0) {
          msg += `🧾 <b>Debts in this project:</b>\n`;
          myDebts.forEach(d => msg += `🔴 You owe <b>${d.amount.toFixed(2)}</b> to ${escapeHtml(names[d.to] || 'Unknown')}\n`);
          myCredits.forEach(c => msg += `🟢 You get <b>${c.amount.toFixed(2)}</b> from ${escapeHtml(names[c.from] || 'Unknown')}\n`);
          msg += `\n`;
        } else {
          msg += `✅ <b>No pending debts in this project!</b>\n\n`;
        }

        msg += `💰 <b>Total Paid:</b> ${totalPaid[userId]?.toFixed(2) || '0.00'}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}\n`;
        msg += `🍽️ <b>Your Share:</b> ${totalShare[userId]?.toFixed(2) || '0.00'}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}\n`;
        msg += `------------------------------------\n`;
        if (myBal > 0.01) msg += `🟢 <b>Net Total:</b> Gets back <b>+${myBal.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}</b>`;
        else if (myBal < -0.01) msg += `🔴 <b>Net Total:</b> Owes <b>${myBal.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}</b>`;
        else msg += `⚪ <b>Net Total:</b> Settled ($0.00)`;

        const kb = new InlineKeyboard()
          .text("« My Balances", "pv_back_bal")
          .text("« My Projects", "pv_back_proj");
        await ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery("pv_back_bal", async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        if (ctx.chat?.type === "private") {
          await ctx.deleteMessage().catch(() => {});
          await showPrivateBalances(ctx);
        }
      });

      bot.callbackQuery("pv_back_proj", async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        if (ctx.chat?.type === "private") {
          await ctx.deleteMessage().catch(() => {});
          await showPrivateProjects(ctx);
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