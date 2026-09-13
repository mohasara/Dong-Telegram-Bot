import { Bot, webhookCallback, InlineKeyboard, Keyboard, Context } from "grammy";
import { Language, escapeHtml, t } from "./i18n";

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
}

export const GROUP_COMMANDS = [
  { command: "new", description: "Create a new project" },
  { command: "add", description: "Record an expense (supports math: 5000+2000 Taxi)" },
  { command: "pay", description: "Record a repayment transfer" },
  { command: "transaction", description: "View details and delete transactions" },
  { command: "balances", description: "View member balances & breakdown" },
  { command: "settle", description: "Optimal settlement plan (who pays whom)" },
  { command: "projects", description: "Projects, reports & close/delete projects" },
  { command: "lang", description: "Change language (English / فارسی)" },
  { command: "help", description: "How to use Dong Bot" },
];

export const pvKeyboardEn = new Keyboard()
  .text("👤 My Balances").text("📁 My Projects").row()
  .text("🧾 Transactions").text("❓ Help & Guide").row()
  .resized()
  .persistent();

export const pvKeyboardFa = new Keyboard()
  .text("👤 حساب من").text("📁 پروژه‌های من").row()
  .text("🧾 تراکنش‌ها").text("❓ راهنما").row()
  .resized()
  .persistent();

export const pvKeyboard = pvKeyboardEn;

export function getPvKeyboard(lang: Language) {
  return lang === "fa" ? pvKeyboardFa : pvKeyboardEn;
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

async function getChatLanguage(db: D1Database, chatId: number): Promise<Language> {
  try {
    const ids = getChatIds(chatId);
    const placeholders = ids.map(() => "?").join(", ");
    const row = await db.prepare(
      `SELECT language FROM chat_settings WHERE chat_id IN (${placeholders}) LIMIT 1`
    ).bind(...ids).first() as any;
    if (row && (row.language === "fa" || row.language === "en")) {
      return row.language as Language;
    }
  } catch (_) {
    try {
      await db.prepare("CREATE TABLE IF NOT EXISTS chat_settings (chat_id INTEGER PRIMARY KEY, language TEXT DEFAULT 'en' NOT NULL)").run();
    } catch (_) {}
  }
  return "en";
}

async function setChatLanguage(db: D1Database, chatId: number, lang: Language): Promise<void> {
  try {
    await db.prepare("INSERT OR REPLACE INTO chat_settings (chat_id, language) VALUES (?, ?)").bind(chatId, lang).run();
  } catch (_) {
    try {
      await db.prepare("CREATE TABLE IF NOT EXISTS chat_settings (chat_id INTEGER PRIMARY KEY, language TEXT DEFAULT 'en' NOT NULL)").run();
      await db.prepare("INSERT OR REPLACE INTO chat_settings (chat_id, language) VALUES (?, ?)").bind(chatId, lang).run();
    } catch (_) {}
  }
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
  for (const tItem of (transfers as any[])) {
    if (netBalances[tItem.from_user_id] !== undefined) netBalances[tItem.from_user_id] += Number(tItem.amount);
    if (netBalances[tItem.to_user_id] !== undefined) netBalances[tItem.to_user_id] -= Number(tItem.amount);
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

function solveSettlement(netBalances: Record<number, number>, names: Record<number, string>, currency: string, lang: Language = "en") {
  const txs = getSettlementTransactions(netBalances);
  const currStr = currency ? ' ' + escapeHtml(currency) : '';
  return txs.map(tItem => t.settleTransferLine(lang, names[tItem.from] || 'Unknown', names[tItem.to] || 'Unknown', `${tItem.amount.toFixed(2)}${currStr}`));
}

async function routeProjectCommand(ctx: Context, db: D1Database, action: string, payload: string = "", cmdMsgId: number = 0, lang: Language = "en"): Promise<{ projectId: number | null }> {
  if (!ctx.chat) return { projectId: null };
  const active = await getActiveProjects(db, ctx.chat.id);
  if (active.length === 0) {
    const kb = new InlineKeyboard().text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
    await ctx.reply(t.noActiveProjects(lang), { reply_markup: kb });
    return { projectId: null };
  }
  if (active.length === 1) return { projectId: active[0].id };
  const kb = new InlineKeyboard();
  for (const p of active) {
    const fullPayload = payload || (cmdMsgId ? `${cmdMsgId}` : "");
    const data = fullPayload ? `selproj_${action}_${p.id}_${fullPayload}` : `selproj_${action}_${p.id}`;
    kb.text(`${p.name}${p.currency ? ' (' + p.currency + ')' : ''}`, data).row();
  }
  if (payload.startsWith("exp_") || payload.startsWith("pay_")) {
    kb.text(t.cancelBtn(lang), `canceldraft_${payload}`).row();
  } else if (cmdMsgId) {
    kb.text(t.closeBtn(lang), `closeflow_${cmdMsgId}`).row();
  } else {
    kb.text(t.closeBtn(lang), "closemsg").row();
  }
  await ctx.reply(t.chooseProject(lang), { reply_markup: kb });
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

      const createProjectAndFinish = async (ctx: Context, name: string, currency: string, draftId: string, msgIds: number[], lang: Language) => {
        if (!ctx.chat) return;
        const proj = await env.DB.prepare("INSERT INTO projects (chat_id, name, currency) VALUES (?, ?, ?) RETURNING id").bind(ctx.chat.id, name, currency).first() as any;
        await env.DB.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, name) VALUES (?, ?, ?)").bind(proj.id, ctx.from!.id, ctx.from!.first_name).run();
        if (draftId) await deleteDraft(env.DB, draftId);

        const mainCmdId = msgIds.find(id => id > 0) || 0;
        const kb = new InlineKeyboard()
          .text(t.joinProjectBtn(lang), mainCmdId ? `join_${proj.id}_${mainCmdId}` : `join_${proj.id}`)
          .text(t.doneAddingBtn(lang), mainCmdId ? `join_done_${proj.id}_${mainCmdId}` : `join_done_${proj.id}`);
        await ctx.reply(
          t.projectCreated(lang, name, currency, escapeHtml(ctx.from!.first_name), `project_join_${proj.id}_${mainCmdId}`),
          { parse_mode: "HTML", reply_markup: kb }
        );

        if (msgIds.length > 0) {
          await deleteMessages(ctx, ctx.chat.id, msgIds);
        }
      };

      const processNew = async (ctx: Context, args: string[], initialMsgIds: number[] = [], lang: Language) => {
        if (!ctx.chat) return;
        if (!args || args.length === 0) return ctx.reply(t.missingProjectName(lang));
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
        await createProjectAndFinish(ctx, name, currency, "", initialMsgIds, lang);
      };

      const promptAddDescription = async (ctx: Context, db: D1Database, draftId: string, draft: any, lang: Language) => {
        const promptText = draft.isItemized
          ? t.addStep2PromptUnequal(lang, draftId)
          : t.addStep2PromptFixed(lang, draft.amount, draftId);

        const replyToId = ctx.message?.message_id || ctx.callbackQuery?.message?.message_id;
        const promptMsg = await ctx.reply(promptText, {
          parse_mode: "HTML",
          reply_parameters: replyToId ? { message_id: replyToId } : undefined,
          reply_markup: {
            force_reply: true,
            input_field_placeholder: t.addStep2Placeholder(lang)
          }
        });
        const kb = new InlineKeyboard()
          .text(t.skipBtn(lang), `add_skip_desc_${draftId}`)
          .text(t.cancelBtn(lang), `canceldraft_${draftId}`);
        const optMsg = await ctx.reply(
          t.quickActions(lang, `add_step2_${draftId}`),
          { parse_mode: "HTML", reply_markup: kb }
        );
        draft.msgIds = Array.from(new Set([...(draft.msgIds || []), promptMsg.message_id, optMsg.message_id]));
        draft.lang = lang;
        await saveDraft(db, draftId, draft);
      };

      const startAddPayerFlow = async (ctx: Context, draftId: string, draft: any, lang: Language) => {
        const { projectId } = await routeProjectCommand(ctx, env.DB, "add", draftId, 0, lang);
        draft.projectId = projectId;
        draft.payerId = null;
        draft.splitWith = [];
        draft.lang = lang;
        await saveDraft(env.DB, draftId, draft);
        if (projectId) {
          await promptPayerSelection(ctx, env.DB, draftId, projectId, draft.amount, draft.desc, draft.isItemized, lang);
        }
      };

      const processAdd = async (ctx: Context, args: string[], initialMsgIds: number[] = [], lang: Language) => {
        if (!ctx.chat) return;
        const raw = (args || []).join(" ");
        const { mathExpr, desc: parsedDesc } = parseMathInput(raw);
        if (!mathExpr) return ctx.reply(t.missingExpenseAmount(lang));
        const evaluated = safeEval(mathExpr);
        if (isNaN(evaluated) || !isFinite(evaluated) || evaluated <= 0) {
          return ctx.reply(t.invalidMathOrAmount(lang, mathExpr), { parse_mode: "HTML" });
        }
        const amount = Math.round(evaluated * 100) / 100;
        
        let desc = parsedDesc;
        if (!desc) {
          desc = new Date().toISOString().replace('T', ' ').substring(0, 16); 
        }

        const draftId = `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const draft = { amount, desc, projectId: null, payerId: null, splitWith: [], msgIds: initialMsgIds, step: "payer", lang };
        await saveDraft(env.DB, draftId, draft);
        await startAddPayerFlow(ctx, draftId, draft, lang);
      };

      const processPay = async (ctx: Context, args: string[], initialMsgIds: number[] = [], lang: Language) => {
        if (!ctx.chat) return;
        const raw = (args || []).join(" ");
        const { mathExpr } = parseMathInput(raw);
        if (!mathExpr) return ctx.reply(t.missingPaymentAmount(lang));
        const evaluated = safeEval(mathExpr);
        if (isNaN(evaluated) || !isFinite(evaluated) || evaluated <= 0) {
          return ctx.reply(t.invalidMathOrAmount(lang, mathExpr), { parse_mode: "HTML" });
        }
        const amount = Math.round(evaluated * 100) / 100;
        const draftId = `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const { projectId } = await routeProjectCommand(ctx, env.DB, "pay", draftId, 0, lang);
        await saveDraft(env.DB, draftId, { amount, projectId, fromId: null, toId: null, msgIds: initialMsgIds, lang });
        if (projectId) await promptPaySender(ctx, env.DB, draftId, projectId, amount, lang);
      };

      // ====================================================
      // 1. PRIVATE CHAT (PV) SCREENS & HANDLERS
      // ====================================================

      const showPrivateBalances = async (ctx: Context, lang: Language) => {
        if (!ctx.from) return;
        const userId = ctx.from.id;
        const { results: memberships } = await env.DB.prepare(
          "SELECT p.id, p.name, p.currency FROM project_members pm JOIN projects p ON pm.project_id = p.id WHERE pm.user_id = ? AND p.status = 'active'"
        ).bind(userId).all();

        if (!memberships || memberships.length === 0) {
          return ctx.reply(t.pvNotPartOfAnyActive(lang), { reply_markup: getPvKeyboard(lang) });
        }

        let report = t.pvBalancesTitle(lang);
        const kb = new InlineKeyboard();
        for (const proj of (memberships as any[])) {
          const { netBalances } = await calculateBalances(env.DB, proj.id);
          const bal = netBalances[userId] || 0;
          const icon = bal > 0.01 ? "🟢" : bal < -0.01 ? "🔴" : "⚪";
          report += `${icon} <b>${escapeHtml(proj.name)}:</b> ${bal >= 0 ? "+" : ""}${bal.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}\n`;
          kb.text(t.pvBreakdownBtn(lang, proj.name), `pv_proj_${proj.id}`).row();
        }
        report += t.pvTapProjectBelow(lang);
        await ctx.reply(report, { parse_mode: "HTML", reply_markup: kb });
      };

      const showPrivateProjects = async (ctx: Context, lang: Language) => {
        if (!ctx.from) return;
        const userId = ctx.from.id;
        const { results: projects } = await env.DB.prepare(
          "SELECT p.id, p.name, p.currency, p.status, (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count FROM project_members pm JOIN projects p ON pm.project_id = p.id WHERE pm.user_id = ? ORDER BY p.id DESC LIMIT 10"
        ).bind(userId).all();

        if (!projects || projects.length === 0) {
          return ctx.reply(t.pvNotJoinedAnyProjects(lang), { reply_markup: getPvKeyboard(lang) });
        }

        let msg = t.pvProjectsTitle(lang);
        const kb = new InlineKeyboard();
        for (const p of (projects as any[])) {
          const icon = p.status === 'active' ? '🟢' : '🔒';
          const statusText = t.pvStatusLabel(lang, p.status);
          msg += `${icon} <b>${escapeHtml(p.name)}</b>${p.currency ? ' (' + escapeHtml(p.currency) + ')' : ''}\n`;
          msg += `${t.pvMembersCount(lang, p.member_count)} | Status: <b>${statusText}</b>\n\n`;
          kb.text(t.pvDetailsBtn(lang, p.name), `pv_proj_${p.id}`).row();
        }
        await ctx.reply(msg, { parse_mode: "HTML", reply_markup: kb });
      };

      const showPrivateTransactions = async (ctx: Context, lang: Language) => {
        if (!ctx.from) return;
        const userId = ctx.from.id;
        const { results: memberships } = await env.DB.prepare(
          "SELECT p.id, p.name, p.currency FROM project_members pm JOIN projects p ON pm.project_id = p.id WHERE pm.user_id = ? AND p.status = 'active'"
        ).bind(userId).all();

        if (!memberships || memberships.length === 0) {
          return ctx.reply(t.pvNotPartOfAnyActive(lang), { reply_markup: getPvKeyboard(lang) });
        }

        if (memberships.length === 1) {
          return showTransactionsMenu(ctx, env.DB, (memberships[0] as any).id, 1, 0, lang);
        }

        let msg = t.pvSelectProjectTx(lang);
        const kb = new InlineKeyboard();
        for (const proj of (memberships as any[])) {
          kb.text(`🧾 ${proj.name}${proj.currency ? ' (' + proj.currency + ')' : ''}`, `selproj_tx_${proj.id}`).row();
        }
        await ctx.reply(msg, { parse_mode: "HTML", reply_markup: kb });
      };

      const showPrivateHelp = async (ctx: Context, lang: Language) => {
        await ctx.reply(t.helpPrivate(lang), { parse_mode: "HTML", reply_markup: getPvKeyboard(lang) });
      };

      bot.hears(["👤 My Balances", "👤 حساب من"], async (ctx) => {
        if (ctx.chat?.type === "private") {
          const lang = await getChatLanguage(env.DB, ctx.chat.id);
          await showPrivateBalances(ctx, lang);
        }
      });

      bot.hears(["📁 My Projects", "📁 پروژه‌های من"], async (ctx) => {
        if (ctx.chat?.type === "private") {
          const lang = await getChatLanguage(env.DB, ctx.chat.id);
          await showPrivateProjects(ctx, lang);
        }
      });

      bot.hears(["🧾 Transactions", "🧾 تراکنش‌ها"], async (ctx) => {
        if (ctx.chat?.type === "private") {
          const lang = await getChatLanguage(env.DB, ctx.chat.id);
          await showPrivateTransactions(ctx, lang);
        }
      });

      bot.hears(["❓ Help & Guide", "❓ راهنما"], async (ctx) => {
        if (ctx.chat?.type === "private") {
          const lang = await getChatLanguage(env.DB, ctx.chat.id);
          await showPrivateHelp(ctx, lang);
        }
      });

      bot.hears(/^(my\s*balance|balances|حساب|حساب من)$/i, async (ctx) => {
        if (ctx.chat?.type === "private") {
          const lang = await getChatLanguage(env.DB, ctx.chat.id);
          await showPrivateBalances(ctx, lang);
        }
      });

      bot.hears(/^(projects|پروژه‌ها|پروژه.*)$/i, async (ctx) => {
        if (ctx.chat?.type === "private") {
          const lang = await getChatLanguage(env.DB, ctx.chat.id);
          await showPrivateProjects(ctx, lang);
        }
      });

      bot.hears(/^(transactions?|tx|تراکنش|تراکنش‌ها.*)$/i, async (ctx) => {
        if (ctx.chat?.type === "private") {
          const lang = await getChatLanguage(env.DB, ctx.chat.id);
          await showPrivateTransactions(ctx, lang);
        }
      });

      bot.hears(/^(help|راهنما)$/i, async (ctx) => {
        if (ctx.chat?.type === "private") {
          const lang = await getChatLanguage(env.DB, ctx.chat.id);
          await showPrivateHelp(ctx, lang);
        }
      });

      // ====================================================
      // 2. COMMANDS
      // ====================================================

      bot.command(["lang", "language", "zaban"], async (ctx) => {
        if (!ctx.chat) return;
        const cmdMsgId = ctx.message?.message_id || 0;
        const currentLang = await getChatLanguage(env.DB, ctx.chat.id);
        const kb = new InlineKeyboard()
          .text(t.langBtnEn(), cmdMsgId ? `setlang_en_${cmdMsgId}` : "setlang_en")
          .text(t.langBtnFa(), cmdMsgId ? `setlang_fa_${cmdMsgId}` : "setlang_fa")
          .row()
          .text(t.closeBtn(currentLang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        await ctx.reply(t.chooseLangPrompt(), { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^setlang_(en|fa)(?:_(\d+))?$/, async (ctx) => {
        if (!ctx.chat) return;
        const chosenLang = ctx.match[1] as Language;
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;
        await setChatLanguage(env.DB, ctx.chat.id, chosenLang);
        await ctx.answerCallbackQuery(chosenLang === "fa" ? "زبان روی فارسی تنظیم شد!" : "Language set to English!").catch(() => {});

        const kb = new InlineKeyboard().text(t.closeBtn(chosenLang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        if (ctx.chat.type === "private") {
          await ctx.reply(t.langChanged(chosenLang), { parse_mode: "HTML", reply_markup: getPvKeyboard(chosenLang) });
          if (ctx.callbackQuery?.message) {
            await ctx.deleteMessage().catch(() => {});
          }
        } else {
          await ctx.editMessageText(t.langChanged(chosenLang), { parse_mode: "HTML", reply_markup: kb });
        }
      });

      bot.command("start", async (ctx) => {
        if (!ctx.chat) return;
        const lang = await getChatLanguage(env.DB, ctx.chat.id);
        if (ctx.chat.type === "private") {
          return ctx.reply(t.startPrivate(lang), { parse_mode: "HTML", reply_markup: getPvKeyboard(lang) });
        }
        const kb = new InlineKeyboard().text(t.closeBtn(lang), "closemsg");
        await ctx.reply(t.startGroup(lang), { parse_mode: "HTML", reply_markup: kb });
      });

      bot.command("help", async (ctx) => {
        if (!ctx.chat) return;
        const lang = await getChatLanguage(env.DB, ctx.chat.id);
        if (ctx.chat.type === "private") return showPrivateHelp(ctx, lang);
        const kb = new InlineKeyboard().text(t.closeBtn(lang), "closemsg");
        await ctx.reply(t.helpGroup(lang), { parse_mode: "HTML", reply_markup: kb });
      });

      bot.command("mybalance", async (ctx) => {
        if (!ctx.chat) return;
        const lang = await getChatLanguage(env.DB, ctx.chat.id);
        if (ctx.chat.type !== "private") return ctx.reply(t.myBalanceGroupNotice(lang));
        await showPrivateBalances(ctx, lang);
      });

      bot.command("new", async (ctx) => {
        if (!ctx.chat) return;
        const lang = await getChatLanguage(env.DB, ctx.chat.id);
        if (ctx.chat.type === "private") return ctx.reply(t.newPrivateErr(lang));
        const cmdMsgId = ctx.message?.message_id || 0;
        const args = ctx.match.trim().split(/\s+/).filter(Boolean);
        if (args.length === 0) {
          const draftId = `new_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
          const promptMsg = await ctx.reply(
            t.newStep1Prompt(lang, draftId),
            { parse_mode: "HTML", reply_parameters: cmdMsgId ? { message_id: cmdMsgId } : undefined, reply_markup: { force_reply: true, input_field_placeholder: t.newStep1Placeholder(lang) } }
          );
          const kb = new InlineKeyboard().text(t.cancelBtn(lang), `canceldraft_${draftId}`);
          const optMsg = await ctx.reply(
            t.tapToCancel(lang, `new_step1_${draftId}`),
            { parse_mode: "HTML", reply_markup: kb }
          );
          await saveDraft(env.DB, draftId, { step: "name", lang, msgIds: Array.from(new Set([...(cmdMsgId ? [cmdMsgId] : []), promptMsg.message_id, optMsg.message_id])) });
          return;
        }
        await processNew(ctx, args, cmdMsgId ? [cmdMsgId] : [], lang);
      });

      bot.command("add", async (ctx) => {
        if (!ctx.chat) return;
        const lang = await getChatLanguage(env.DB, ctx.chat.id);
        if (ctx.chat.type === "private") return ctx.reply(t.addPrivateErr(lang));
        const cmdMsgId = ctx.message?.message_id || 0;
        const args = ctx.match.trim().split(/\s+/).filter(Boolean);
        if (args.length === 0) {
          const draftId = `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
          const promptMsg = await ctx.reply(
            t.addStep1Prompt(lang, draftId),
            {
              parse_mode: "HTML",
              reply_parameters: cmdMsgId ? { message_id: cmdMsgId } : undefined,
              reply_markup: { force_reply: true, input_field_placeholder: t.addStep1Placeholder(lang) }
            }
          );
          const kb = new InlineKeyboard()
            .text(t.unequalShareBtn(lang), `add_itemized_${draftId}`)
            .text(t.cancelBtn(lang), `canceldraft_${draftId}`);
          const optMsg = await ctx.reply(
            t.addStep1OptMsg(lang, draftId),
            { parse_mode: "HTML", reply_markup: kb }
          );
          await saveDraft(env.DB, draftId, { step: "amount", lang, msgIds: Array.from(new Set([...(cmdMsgId ? [cmdMsgId] : []), promptMsg.message_id, optMsg.message_id])) });
          return;
        }
        if (args[0].toLowerCase() === "unequal" || args[0].toLowerCase() === "itemized") {
          const desc = args.slice(1).join(" ").trim();
          const draftId = `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
          const draft = { isItemized: true, amount: 0, desc: desc || "", step: desc ? "payer" : "desc", lang, msgIds: cmdMsgId ? [cmdMsgId] : [] };
          await saveDraft(env.DB, draftId, draft);
          if (desc) {
            return startAddPayerFlow(ctx, draftId, draft, lang);
          } else {
            return promptAddDescription(ctx, env.DB, draftId, draft, lang);
          }
        }
        await processAdd(ctx, args, cmdMsgId ? [cmdMsgId] : [], lang);
      });

      bot.command("pay", async (ctx) => {
        if (!ctx.chat) return;
        const lang = await getChatLanguage(env.DB, ctx.chat.id);
        if (ctx.chat.type === "private") return ctx.reply(t.payPrivateErr(lang));
        const cmdMsgId = ctx.message?.message_id || 0;
        const args = ctx.match.trim().split(/\s+/).filter(Boolean);
        if (args.length === 0) {
          const draftId = `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
          const promptMsg = await ctx.reply(
            t.payStep1Prompt(lang, draftId),
            { parse_mode: "HTML", reply_parameters: cmdMsgId ? { message_id: cmdMsgId } : undefined, reply_markup: { force_reply: true, input_field_placeholder: t.payStep1Placeholder(lang) } }
          );
          const kb = new InlineKeyboard().text(t.cancelBtn(lang), `canceldraft_${draftId}`);
          const optMsg = await ctx.reply(
            t.tapToCancel(lang, `pay_step1_${draftId}`),
            { parse_mode: "HTML", reply_markup: kb }
          );
          await saveDraft(env.DB, draftId, { step: "amount", lang, msgIds: Array.from(new Set([...(cmdMsgId ? [cmdMsgId] : []), promptMsg.message_id, optMsg.message_id])) });
          return;
        }
        await processPay(ctx, args, cmdMsgId ? [cmdMsgId] : [], lang);
      });

      bot.command(["transaction", "transactions", "tx", "trans"], async (ctx) => {
        if (!ctx.chat) return;
        const lang = await getChatLanguage(env.DB, ctx.chat.id);
        const cmdMsgId = ctx.message?.message_id || 0;
        const { projectId } = await routeProjectCommand(ctx, env.DB, "tx", "", cmdMsgId, lang);
        if (projectId) await showTransactionsMenu(ctx, env.DB, projectId, 1, cmdMsgId, lang);
      });

      bot.command("delete", async (ctx) => {
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        await ctx.reply(t.deleteRetired(lang), { parse_mode: "HTML" });
      });

      bot.command("balances", async (ctx) => {
        if (!ctx.chat) return;
        const lang = await getChatLanguage(env.DB, ctx.chat.id);
        const cmdMsgId = ctx.message?.message_id || 0;
        const { projectId } = await routeProjectCommand(ctx, env.DB, "bal", "", cmdMsgId, lang);
        if (projectId) await showBalancesMenu(ctx, env.DB, projectId, cmdMsgId, lang);
      });

      bot.command("settle", async (ctx) => {
        if (!ctx.chat) return;
        const lang = await getChatLanguage(env.DB, ctx.chat.id);
        const cmdMsgId = ctx.message?.message_id || 0;
        const { projectId } = await routeProjectCommand(ctx, env.DB, "settle", "", cmdMsgId, lang);
        if (projectId) await showSettlement(ctx, env.DB, projectId, cmdMsgId, lang);
      });

      bot.command(["projects", "report"], async (ctx) => {
        if (!ctx.chat) return;
        const lang = await getChatLanguage(env.DB, ctx.chat.id);
        const projects = await getAllProjects(env.DB, ctx.chat.id);
        const cmdMsgId = ctx.message?.message_id || 0;
        if (projects.length === 0) {
          const kb = new InlineKeyboard().text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
          return ctx.reply(t.noProjectsFound(lang), { reply_markup: kb });
        }
        const kb = new InlineKeyboard();
        for (const p of projects) {
          const statusIcon = p.status === "active" ? "🟢" : "🔒";
          const data = cmdMsgId ? `selproj_report_${p.id}_${cmdMsgId}` : `selproj_report_${p.id}`;
          kb.text(`${statusIcon} ${p.name}${p.currency ? ' (' + p.currency + ')' : ''}`, data).row();
        }
        kb.text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        await ctx.reply(t.projectsMenuTitle(lang), { parse_mode: "HTML", reply_markup: kb });
      });

      bot.command("close", async (ctx) => {
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        await ctx.reply(t.closeMoved(lang), { parse_mode: "HTML" });
      });

      // ====================================================
      // 2. MESSAGE CATCHER (CLEANS UP ONLY WHEN JOB IS FINISHED)
      // ====================================================
      
      bot.on("message:text", async (ctx, next) => {
        const replyTo = ctx.message.reply_to_message;
        if (!replyTo || !replyTo.text) return next();
        const chatLang = await getChatLanguage(env.DB, ctx.chat.id);

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
            const existing = await env.DB.prepare("SELECT id FROM project_members WHERE project_id = ? AND LOWER(name) = LOWER(?)").bind(projectId, cleanName).first();
            if (existing) continue;

            const minRow = await env.DB.prepare("SELECT MIN(user_id) as min_id FROM project_members WHERE project_id = ? AND user_id < 0").bind(projectId).first() as any;
            const nextUserId = (minRow && typeof minRow.min_id === "number" && minRow.min_id < 0) ? minRow.min_id - 1 : -1;
            await env.DB.prepare("INSERT INTO project_members (project_id, user_id, name) VALUES (?, ?, ?)").bind(projectId, nextUserId, cleanName).run();
          }

          if (ctx.chat) {
            await deleteMessages(ctx, ctx.chat.id, [ctx.message.message_id]);
          }

          const members = await getProjectMembers(env.DB, projectId);
          const kb = new InlineKeyboard()
            .text(t.joinProjectBtn(chatLang), cmdMsgId ? `join_${projectId}_${cmdMsgId}` : `join_${projectId}`)
            .text(t.doneAddingBtn(chatLang), cmdMsgId ? `join_done_${projectId}_${cmdMsgId}` : `join_done_${projectId}`);
          try {
            await ctx.api.editMessageText(
              ctx.chat.id,
              replyTo.message_id,
              t.projectCreated(chatLang, proj.name, proj.currency, members.map(m => escapeHtml(m.name)).join(", "), `project_join_${projectId}_${cmdMsgId}`),
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
          const draftLang = draft?.lang || chatLang;
          if (!draft) return ctx.reply(t.sessionExpired(draftLang));

          const text = ctx.message.text.trim();
          if (text.toLowerCase() === "cancel" || text.toLowerCase() === "/cancel" || text === "انصراف") {
            await deleteDraft(env.DB, draftId);
            const toDelete = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id])).filter((id): id is number => typeof id === "number" && id > 0);
            if (ctx.chat && toDelete.length > 0) await deleteMessages(ctx, ctx.chat.id, toDelete);
            return ctx.reply(t.projectCancelled(draftLang));
          }
          if (!text) return ctx.reply(t.missingProjectName(draftLang));

          draft.msgIds = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id]));
          
          const parts = text.split(/\s+/).filter(Boolean);
          if (parts.length > 1) {
            const last = parts[parts.length - 1];
            if (/^[$€£¥﷼]|^(USD|EUR|GBP|IRR|TOMAN|CAD|AUD)$/i.test(last)) {
              const name = parts.slice(0, -1).join(" ");
              const currency = last;
              await createProjectAndFinish(ctx, name, currency, draftId, draft.msgIds, draftLang);
              return;
            }
          }

          draft.name = text;
          draft.step = "currency";
          await saveDraft(env.DB, draftId, draft);

          const prompt2 = await ctx.reply(
            t.newStep2Prompt(draftLang, draft.name, draftId),
            {
              parse_mode: "HTML",
              reply_parameters: { message_id: ctx.message.message_id },
              reply_markup: { force_reply: true, input_field_placeholder: t.newStep2Placeholder(draftLang) }
            }
          );
          const kb2 = new InlineKeyboard()
            .text(t.skipBtn(draftLang), `new_skip_curr_${draftId}`)
            .text(t.cancelBtn(draftLang), `canceldraft_${draftId}`);
          const opt2 = await ctx.reply(
            t.quickActions(draftLang, `new_step2_${draftId}`),
            { parse_mode: "HTML", reply_markup: kb2 }
          );
          draft.msgIds = Array.from(new Set([...(draft.msgIds || []), prompt2.message_id, opt2.message_id]));
          await saveDraft(env.DB, draftId, draft);
          return;
        }

        // --- Step-by-Step /new: Step 2 (Currency) ---
        const newStep2Match = replyTo.text.match(/\[Action:\s*new_step2_([a-zA-Z0-9_]+)\]/);
        if (newStep2Match) {
          const draftId = newStep2Match[1];
          const draft = await getDraft(env.DB, draftId);
          const draftLang = draft?.lang || chatLang;
          if (!draft) return ctx.reply(t.sessionExpired(draftLang));

          let currency = ctx.message.text.trim();
          if (currency.toLowerCase() === "cancel" || currency.toLowerCase() === "/cancel" || currency === "انصراف") {
            await deleteDraft(env.DB, draftId);
            const toDelete = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id])).filter((id): id is number => typeof id === "number" && id > 0);
            if (ctx.chat && toDelete.length > 0) await deleteMessages(ctx, ctx.chat.id, toDelete);
            return ctx.reply(t.projectCancelled(draftLang));
          }
          if (currency === "-" || currency.toLowerCase() === "skip" || currency.toLowerCase() === "none" || currency === "." || currency === "رد کردن") {
            currency = "";
          }
          draft.msgIds = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id]));
          await createProjectAndFinish(ctx, draft.name, currency, draftId, draft.msgIds, draftLang);
          return;
        }

        // --- Step-by-Step /add: Step 1 (Amount) ---
        const addStep1Match = replyTo.text.match(/\[Action:\s*add_step1_([a-zA-Z0-9_]+)\]/);
        if (addStep1Match) {
          const draftId = addStep1Match[1];
          const draft = await getDraft(env.DB, draftId);
          const draftLang = draft?.lang || chatLang;
          if (!draft) return ctx.reply(t.sessionExpired(draftLang));

          const raw = ctx.message.text.trim();
          if (raw.toLowerCase() === "cancel" || raw.toLowerCase() === "/cancel" || raw === "انصراف") {
            await deleteDraft(env.DB, draftId);
            const toDelete = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id])).filter((id): id is number => typeof id === "number" && id > 0);
            if (ctx.chat && toDelete.length > 0) await deleteMessages(ctx, ctx.chat.id, toDelete);
            return ctx.reply(t.expenseCancelled(draftLang));
          }
          if (raw.toLowerCase() === "unequal" || raw.toLowerCase() === "itemized" || raw === "-" || raw.toLowerCase() === "skip" || raw === "دُنگ نامساوی" || raw === "دنگ نامساوی" || raw === "دانگ نامساوی" || raw === "رد کردن") {
            draft.isItemized = true;
            draft.amount = 0;
            draft.step = "desc";
            draft.msgIds = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id]));
            await saveDraft(env.DB, draftId, draft);
            return promptAddDescription(ctx, env.DB, draftId, draft, draftLang);
          }
          const { mathExpr, desc: parsedDesc } = parseMathInput(raw);
          if (!mathExpr) return ctx.reply(t.missingExpenseAmount(draftLang));
          const evaluated = safeEval(mathExpr);
          if (isNaN(evaluated) || !isFinite(evaluated) || evaluated <= 0) {
            return ctx.reply(t.invalidMathOrAmount(draftLang, mathExpr), { parse_mode: "HTML" });
          }
          const amount = Math.round(evaluated * 100) / 100;
          draft.amount = amount;
          draft.msgIds = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id]));

          if (parsedDesc) {
            draft.desc = parsedDesc;
            draft.step = "payer";
            await saveDraft(env.DB, draftId, draft);
            return startAddPayerFlow(ctx, draftId, draft, draftLang);
          }

          draft.step = "desc";
          await saveDraft(env.DB, draftId, draft);
          return promptAddDescription(ctx, env.DB, draftId, draft, draftLang);
        }

        // --- Step-by-Step /add: Step 2 (Description) ---
        const addStep2Match = replyTo.text.match(/\[Action:\s*add_step2_([a-zA-Z0-9_]+)\]/);
        if (addStep2Match) {
          const draftId = addStep2Match[1];
          const draft = await getDraft(env.DB, draftId);
          const draftLang = draft?.lang || chatLang;
          if (!draft) return ctx.reply(t.sessionExpired(draftLang));

          let desc = ctx.message.text.trim();
          if (desc.toLowerCase() === "cancel" || desc.toLowerCase() === "/cancel" || desc === "انصراف") {
            await deleteDraft(env.DB, draftId);
            const toDelete = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id])).filter((id): id is number => typeof id === "number" && id > 0);
            if (ctx.chat && toDelete.length > 0) await deleteMessages(ctx, ctx.chat.id, toDelete);
            return ctx.reply(t.expenseCancelled(draftLang));
          }
          if (!desc || desc === "-" || desc.toLowerCase() === "skip" || desc.toLowerCase() === "none" || desc === "." || desc === "رد کردن") {
            desc = new Date().toISOString().replace('T', ' ').substring(0, 16);
          }
          draft.desc = desc;
          draft.msgIds = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id]));
          draft.step = "payer";
          await saveDraft(env.DB, draftId, draft);
          return startAddPayerFlow(ctx, draftId, draft, draftLang);
        }

        // --- Step-by-Step /pay: Step 1 (Amount) ---
        const payStep1Match = replyTo.text.match(/\[Action:\s*pay_step1_([a-zA-Z0-9_]+)\]/);
        if (payStep1Match) {
          const draftId = payStep1Match[1];
          const draft = await getDraft(env.DB, draftId);
          const draftLang = draft?.lang || chatLang;
          if (!draft) return ctx.reply(t.sessionExpired(draftLang));

          const raw = ctx.message.text.trim();
          if (raw.toLowerCase() === "cancel" || raw.toLowerCase() === "/cancel" || raw === "انصراف") {
            await deleteDraft(env.DB, draftId);
            const toDelete = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id])).filter((id): id is number => typeof id === "number" && id > 0);
            if (ctx.chat && toDelete.length > 0) await deleteMessages(ctx, ctx.chat.id, toDelete);
            return ctx.reply(t.paymentCancelled(draftLang));
          }
          const { mathExpr } = parseMathInput(raw);
          if (!mathExpr) return ctx.reply(t.missingPaymentAmount(draftLang));
          const evaluated = safeEval(mathExpr);
          if (isNaN(evaluated) || !isFinite(evaluated) || evaluated <= 0) {
            return ctx.reply(t.invalidMathOrAmount(draftLang, mathExpr), { parse_mode: "HTML" });
          }
          const amount = Math.round(evaluated * 100) / 100;
          draft.amount = amount;
          draft.msgIds = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id]));

          const { projectId } = await routeProjectCommand(ctx, env.DB, "pay", draftId, 0, draftLang);
          draft.projectId = projectId;
          draft.fromId = null;
          draft.toId = null;
          await saveDraft(env.DB, draftId, draft);
          if (projectId) await promptPaySender(ctx, env.DB, draftId, projectId, amount, draftLang);
          return;
        }

        // Catch legacy missing argument prompts
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
          
          if (action === "new_prompt") return processNew(ctx, args, promptMsgIds, chatLang);
          if (action === "add_prompt") return processAdd(ctx, args, promptMsgIds, chatLang);
          if (action === "pay_prompt") return processPay(ctx, args, promptMsgIds, chatLang);
          return next();
        }

        // --- Step-by-Step Unequal Split: Individual Shares ---
        const splitStepMatch = replyTo.text.match(/\[Action:\s*split_step_([a-zA-Z0-9_]+)\]/);
        if (splitStepMatch) {
          const draftId = splitStepMatch[1];
          const draft = await getDraft(env.DB, draftId);
          const draftLang = draft?.lang || chatLang;
          if (!draft || !draft.splitOrder) return ctx.reply(t.sessionExpired(draftLang));

          const raw = ctx.message.text.trim();
          if (raw.toLowerCase() === "cancel" || raw.toLowerCase() === "/cancel" || raw === "انصراف") {
            await deleteDraft(env.DB, draftId);
            const toDelete = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id])).filter((id): id is number => typeof id === "number" && id > 0);
            if (ctx.chat && toDelete.length > 0) {
              await deleteMessages(ctx, ctx.chat.id, toDelete);
            }
            return ctx.reply(t.expenseCancelled(draftLang));
          }

          const { mathExpr } = parseMathInput(raw);
          const amt = safeEval(mathExpr || raw);
          if (isNaN(amt) || !isFinite(amt) || amt < 0) {
            const members = await getProjectMembers(env.DB, draft.projectId);
            const curMember = members.find(m => m.user_id === draft.splitOrder[draft.currentShareIndex]);
            const curName = curMember?.name || "this person";
            const errPrompt = await ctx.reply(
              draftLang === 'fa'
                ? `❌ مبلغ نامعتبر است: '<code>${escapeHtml(raw)}</code>'\n\nلطفاً یک عدد معتبر یا 0 برای <b>${escapeHtml(curName)}</b> بفرستید:\n\n<span class="tg-spoiler">[Action: split_step_${draftId}]</span>`
                : `❌ Invalid amount: '<code>${escapeHtml(raw)}</code>'\n\nPlease reply with a valid number or 0 for <b>${escapeHtml(curName)}</b>:\n\n<span class="tg-spoiler">[Action: split_step_${draftId}]</span>`,
              {
                parse_mode: "HTML",
                reply_parameters: { message_id: ctx.message.message_id },
                reply_markup: { force_reply: true, input_field_placeholder: t.sharePlaceholder(draftLang, curName) }
              }
            );
            const kb = new InlineKeyboard().text(t.cancelBtn(draftLang), `canceldraft_${draftId}`);
            const errOpt = await ctx.reply(
              t.tapToCancel(draftLang, `split_step_${draftId}`),
              { parse_mode: "HTML", reply_markup: kb }
            );
            draft.msgIds = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id, errPrompt.message_id, errOpt.message_id]));
            await saveDraft(env.DB, draftId, draft);
            return;
          }

          const roundedAmt = Math.round(amt * 100) / 100;
          const currentUserId = draft.splitOrder[draft.currentShareIndex];

          if (!draft.isItemized && draft.amount > 0) {
            let allocatedSoFar = 0;
            for (let i = 0; i < draft.currentShareIndex; i++) {
              allocatedSoFar += (draft.shares?.[draft.splitOrder[i]] || 0);
            }
            allocatedSoFar = Math.round(allocatedSoFar * 100) / 100;
            const remaining = Math.round((draft.amount - allocatedSoFar) * 100) / 100;

            if (roundedAmt > remaining + 0.01) {
              const rem = Math.max(0, remaining);
              const errPrompt = await ctx.reply(
                t.amountExceedsRemaining(draftLang, roundedAmt, rem, draft.amount, draftId),
                {
                  parse_mode: "HTML",
                  reply_parameters: { message_id: ctx.message.message_id },
                  reply_markup: { force_reply: true, input_field_placeholder: `${rem}` }
                }
              );
              const kb = new InlineKeyboard().text(t.cancelBtn(draftLang), `canceldraft_${draftId}`);
              const errOpt = await ctx.reply(
                t.tapToCancel(draftLang, `split_step_${draftId}`),
                { parse_mode: "HTML", reply_markup: kb }
              );
              draft.msgIds = Array.from(new Set([...(draft.msgIds || []), ctx.message.message_id, errPrompt.message_id, errOpt.message_id]));
              await saveDraft(env.DB, draftId, draft);
              return;
            }
          }

          if (!draft.shares) draft.shares = {};
          draft.shares[currentUserId] = roundedAmt;
          draft.msgIds = Array.from(new Set([...(draft.msgIds || []), replyTo.message_id, ctx.message.message_id]));
          draft.currentShareIndex = (draft.currentShareIndex || 0) + 1;

          if (!draft.isItemized && draft.amount > 0) {
            let totalAllocated = 0;
            for (let i = 0; i < draft.currentShareIndex; i++) {
              totalAllocated += (draft.shares[draft.splitOrder[i]] || 0);
            }
            totalAllocated = Math.round(totalAllocated * 100) / 100;

            if (Math.abs(totalAllocated - draft.amount) <= 0.01) {
              for (let k = draft.currentShareIndex; k < draft.splitOrder.length; k++) {
                const remUid = draft.splitOrder[k];
                draft.shares[remUid] = 0;
              }
              draft.currentShareIndex = draft.splitOrder.length;
            }
          }

          if (draft.currentShareIndex < draft.splitOrder.length) {
            await saveDraft(env.DB, draftId, draft);
            return promptNextShare(ctx, env.DB, draftId, draft, draftLang);
          }

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
              return ctx.reply(t.totalZeroCancelled(draftLang));
            }
            draft.amount = totalSum;
          } else {
            if (Math.abs(totalSum - draft.amount) > 0.01) {
              await saveDraft(env.DB, draftId, draft);
              const diff = Math.round((draft.amount - totalSum) * 100) / 100;
              const kb = new InlineKeyboard()
                .text(t.setTotalToBtn(draftLang, totalSum), `exp_fixsum_${draftId}_${totalSum}`)
                .row()
                .text(t.restartSharesBtn(draftLang), `expunequal_${draftId}`)
                .text(t.cancelBtn(draftLang), `canceldraft_${draftId}`);
              return ctx.reply(
                t.totalMismatch(draftLang, totalSum, draft.amount, diff),
                { parse_mode: "HTML", reply_markup: kb }
              );
            }
          }

          return finalizeUnequalExpense(ctx, env.DB, draftId, draft, userShares, draftLang);
        }

        return next();
      });

      // ====================================================
      // 3. CALLBACK QUERY HANDLERS (BUTTON CLICKS)
      // ====================================================

      bot.callbackQuery(/^join_(\d+)(?:_(\d+))?$/, async (ctx) => {
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const projectId = Number(ctx.match[1]);
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;
        await env.DB.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, name) VALUES (?, ?, ?)").bind(projectId, ctx.from.id, ctx.from.first_name).run();
        const members = await getProjectMembers(env.DB, projectId);
        const proj = await getProjectById(env.DB, projectId);
        if (proj) {
          const kb = new InlineKeyboard()
            .text(t.joinProjectBtn(lang), cmdMsgId ? `join_${projectId}_${cmdMsgId}` : `join_${projectId}`)
            .text(t.doneAddingBtn(lang), cmdMsgId ? `join_done_${projectId}_${cmdMsgId}` : `join_done_${projectId}`);
          try {
            await ctx.editMessageText(
              t.projectCreated(lang, proj.name, proj.currency, members.map(m => escapeHtml(m.name)).join(", "), `project_join_${projectId}_${cmdMsgId}`),
              { parse_mode: "HTML", reply_markup: kb }
            );
          } catch (_) {}
        }
        await ctx.answerCallbackQuery(t.joinedAlert(lang)).catch(() => {});
      });

      bot.callbackQuery(/^join_done_(\d+)(?:_(\d+))?$/, async (ctx) => {
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        await ctx.answerCallbackQuery().catch(() => {});
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;
        const kb = new InlineKeyboard().text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        try {
          await ctx.editMessageText(t.groupLocked(lang), { reply_markup: kb });
        } catch (_) {}
      });

      // --- STEP-BY-STEP SKIP HANDLERS ---
      bot.callbackQuery(/^new_skip_curr_([a-zA-Z0-9_]+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        const lang = draft.lang || await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const currentMsgId = ctx.callbackQuery?.message?.message_id;
        const allMsgIds = Array.from(new Set([...(draft.msgIds || []), ...(currentMsgId ? [currentMsgId] : [])])).filter((id): id is number => typeof id === "number" && id > 0);
        await createProjectAndFinish(ctx, draft.name, "", draftId, allMsgIds, lang);
      });

      bot.callbackQuery(/^add_skip_desc_([a-zA-Z0-9_]+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        const lang = draft.lang || await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const currentMsgId = ctx.callbackQuery?.message?.message_id;
        if (currentMsgId) {
          draft.msgIds = Array.from(new Set([...(draft.msgIds || []), currentMsgId]));
        }
        draft.desc = new Date().toISOString().replace('T', ' ').substring(0, 16);
        draft.step = "payer";
        await saveDraft(env.DB, draftId, draft);
        return startAddPayerFlow(ctx, draftId, draft, lang);
      });

      bot.callbackQuery(/^add_itemized_(exp_.+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        const lang = draft?.lang || await getChatLanguage(env.DB, ctx.chat?.id || 0);
        if (!draft) return ctx.reply(t.sessionExpired(lang));

        draft.isItemized = true;
        draft.amount = 0;
        draft.step = "desc";
        const currentMsgId = ctx.callbackQuery?.message?.message_id;
        if (currentMsgId) {
          draft.msgIds = Array.from(new Set([...(draft.msgIds || []), currentMsgId]));
        }
        await saveDraft(env.DB, draftId, draft);

        try {
          await ctx.editMessageText(t.unequalModeNotice(lang), { parse_mode: "HTML" });
        } catch (_) {}

        return promptAddDescription(ctx, env.DB, draftId, draft, lang);
      });

      // --- ADD EXPENSE CALLBACKS ---
      bot.callbackQuery(/^selproj_add_(\d+)_(exp_.+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[2];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        const lang = draft.lang || await getChatLanguage(env.DB, ctx.chat?.id || 0);
        draft.projectId = Number(ctx.match[1]);
        await saveDraft(env.DB, draftId, draft);
        await promptPayerSelection(ctx, env.DB, draftId, draft.projectId, draft.amount, draft.desc, draft.isItemized, lang);
      });

      bot.callbackQuery(/^exppayer_(exp_.+)_(-?\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        const lang = draft.lang || await getChatLanguage(env.DB, ctx.chat?.id || 0);
        draft.payerId = Number(ctx.match[2]);
        draft.splitWith = (await getProjectMembers(env.DB, draft.projectId)).map(m => m.user_id);
        await saveDraft(env.DB, draftId, draft);
        await renderSplitSelection(ctx, env.DB, draftId, draft, lang);
      });

      async function promptPayerSelection(ctx: Context, db: D1Database, draftId: string, projId: number, amount: number, desc: string, isItemized: boolean = false, lang: Language = "en") {
        const members = await getProjectMembers(db, projId);
        if (members.length === 0) {
          const text = t.noMembersInProject(lang, "");
          const kb = new InlineKeyboard().text(t.cancelBtn(lang), `canceldraft_${draftId}`);
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
        kb.text(t.cancelBtn(lang), `canceldraft_${draftId}`);

        const amountLabel = isItemized ? (lang === 'fa' ? "(⚡ دُنگ نامساوی)" : "(⚡ Unequal Share)") : `(${amount})`;
        const text = t.promptPayer(lang, desc, amountLabel);
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

      async function renderSplitSelection(ctx: Context, db: D1Database, draftId: string, draft: any, lang: Language = "en") {
        const members = await getProjectMembers(db, draft.projectId);
        const kb = new InlineKeyboard();
        for (let i = 0; i < members.length; i++) {
          const m = members[i];
          kb.text(`${draft.splitWith.includes(m.user_id) ? "✅" : "❌"} ${m.name}`, `exptoggle_${draftId}_${m.user_id}`);
          if (i % 2 === 1) kb.row();
        }
        if (members.length % 2 !== 0) kb.row();

        if (draft.isItemized) {
          kb.text(t.enterSharesBtn(lang), `expunequal_${draftId}`).row();
        } else {
          kb.text(t.unequalSplitBtn(lang), `expunequal_${draftId}`).text(t.confirmEqualBtn(lang), `expconfirm_${draftId}`).row();
        }
        kb.text(t.cancelBtn(lang), `canceldraft_${draftId}`);

        const header = draft.isItemized
          ? t.splitSelectHeaderUnequal(lang, draft.desc)
          : t.splitSelectHeaderEqual(lang, draft.desc, draft.amount);

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
        const lang = draft.lang || await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const uid = Number(ctx.match[2]);
        draft.splitWith = draft.splitWith.includes(uid) ? draft.splitWith.filter((id: number) => id !== uid) : [...draft.splitWith, uid];
        await saveDraft(env.DB, draftId, draft);
        await renderSplitSelection(ctx, env.DB, draftId, draft, lang);
      });

      bot.callbackQuery(/^expconfirm_(exp_.+)$/, async (ctx) => {
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        const lang = draft.lang || await getChatLanguage(env.DB, ctx.chat?.id || 0);
        if (draft.isItemized || !draft.amount || draft.amount <= 0) {
          await ctx.answerCallbackQuery(t.useUnequalToEnterShares(lang)).catch(() => {});
          return;
        }
        if (!draft.splitWith || draft.splitWith.length === 0) {
          await ctx.answerCallbackQuery(t.selectAtLeastOne(lang)).catch(() => {});
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
          .text(t.undoBtn(lang), `delexp_${exp.id}_${draft.projectId}`)
          .text(t.closeBtn(lang), "closemsg");
        await ctx.editMessageText(t.expenseSavedEqual(lang, draft.desc, draft.amount, draft.splitWith.length), { parse_mode: "HTML", reply_markup: kb });

        if (ctx.chat && toDelete.length > 0) {
          await deleteMessages(ctx, ctx.chat.id, toDelete);
        }
      });

      bot.callbackQuery(/^expunequal_(exp_.+)$/, async (ctx) => {
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        const lang = draft.lang || await getChatLanguage(env.DB, ctx.chat?.id || 0);

        const members = await getProjectMembers(env.DB, draft.projectId);
        const activeMembers = members.filter(m => draft.splitWith.includes(m.user_id));
        if (activeMembers.length === 0) {
          await ctx.answerCallbackQuery(t.selectAtLeastOne(lang)).catch(() => {});
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
          await ctx.editMessageText(t.enteringSharesBelow(lang), { parse_mode: "HTML" });
        } catch (_) {}

        await promptNextShare(ctx, env.DB, draftId, draft, lang);
      });

      async function promptNextShare(ctx: Context, db: D1Database, draftId: string, draft: any, lang: Language = "en") {
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
            progress += `\u200E• ${escapeHtml(name)}: <b>${draft.shares?.[uid] ?? 0}</b>\n`;
          } else if (i === draft.currentShareIndex) {
            progress += `\u200E👉 <b>${escapeHtml(name)}:</b> <i>(${lang === 'fa' ? 'در انتظار ورود سهم...' : 'awaiting reply...'})</i>\n`;
          } else {
            progress += `\u200E• ${escapeHtml(name)}: ⏳\n`;
          }
        }

        let status = "";
        let placeholder = t.sharePlaceholder(lang, memberName);
        if (draft.isItemized) {
          status = allocatedSum > 0 ? (lang === 'fa' ? `\n💰 <b>مجموع فعلی:</b> ${allocatedSum}` : `\n💰 <b>Current Total:</b> ${allocatedSum}`) : "";
        } else {
          const remaining = Math.round((draft.amount - allocatedSum) * 100) / 100;
          status = lang === 'fa'
            ? `\n💰 <b>ثبت‌شده:</b> ${allocatedSum} | <b>باقی‌مانده:</b> ${remaining} (کل: ${draft.amount})`
            : `\n💰 <b>Allocated:</b> ${allocatedSum} | <b>Remaining:</b> ${remaining} (Total: ${draft.amount})`;
          if (draft.currentShareIndex === draft.splitOrder.length - 1 && remaining > 0) {
            placeholder = `${remaining}`;
          }
        }

        const promptText = t.promptNextShareMsg(
          lang,
          draft.desc,
          draft.currentShareIndex + 1,
          draft.splitOrder.length,
          progress,
          status,
          memberName,
          draftId
        );

        const replyToId = ctx.message?.message_id || ctx.callbackQuery?.message?.message_id;
        const promptMsg = await ctx.reply(promptText, {
          parse_mode: "HTML",
          reply_parameters: replyToId ? { message_id: replyToId } : undefined,
          reply_markup: {
            force_reply: true,
            input_field_placeholder: placeholder
          }
        });
        const kb = new InlineKeyboard().text(t.cancelBtn(lang), `canceldraft_${draftId}`);
        const optMsg = await ctx.reply(
          t.tapToCancel(lang, `split_step_${draftId}`),
          { parse_mode: "HTML", reply_markup: kb }
        );
        draft.msgIds = Array.from(new Set([...(draft.msgIds || []), promptMsg.message_id, optMsg.message_id]));
        draft.lang = lang;
        await saveDraft(db, draftId, draft);
      }

      async function finalizeUnequalExpense(
        ctx: Context,
        db: D1Database,
        draftId: string,
        draft: any,
        userShares: { userId: number; amount: number; name: string }[],
        lang: Language = "en"
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
          .text(t.undoBtn(lang), `delexp_${exp.id}_${draft.projectId}`)
          .text(t.closeBtn(lang), "closemsg");

        let reportMsg = t.expenseSavedUnequalHeader(lang, desc, draft.amount);
        userShares.forEach(s => reportMsg += `\u200E• ${escapeHtml(s.name)}: <b>${s.amount}</b>\n`);

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
        const lang = draft?.lang || await getChatLanguage(env.DB, ctx.chat?.id || 0);
        if (!draft || !draft.splitOrder || !draft.shares) return ctx.reply(t.sessionExpired(lang));

        draft.amount = newTotal;
        const members = await getProjectMembers(env.DB, draft.projectId);
        const userShares = draft.splitOrder.map((uid: number) => ({
          userId: uid,
          amount: draft.shares[uid] || 0,
          name: members.find(m => m.user_id === uid)?.name || "Unknown"
        }));

        return finalizeUnequalExpense(ctx, env.DB, draftId, draft, userShares, lang);
      });

      // --- PAY CALLBACKS ---
      bot.callbackQuery(/^selproj_pay_(\d+)_(pay_.+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[2];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        const lang = draft.lang || await getChatLanguage(env.DB, ctx.chat?.id || 0);
        draft.projectId = Number(ctx.match[1]);
        await saveDraft(env.DB, draftId, draft);
        await promptPaySender(ctx, env.DB, draftId, draft.projectId, draft.amount, lang);
      });

      async function promptPaySender(ctx: Context, db: D1Database, draftId: string, projId: number, amount: number, lang: Language = "en") {
        const members = await getProjectMembers(db, projId);
        if (members.length === 0) {
          const text = t.noMembersInProject(lang, "");
          const kb = new InlineKeyboard().text(t.cancelBtn(lang), `canceldraft_${draftId}`);
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
        kb.text(t.cancelBtn(lang), `canceldraft_${draftId}`);

        const text = t.promptPaySender(lang, amount);
        if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
        else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
      }

      bot.callbackQuery(/^payfrom_(pay_.+)_(-?\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        const lang = draft.lang || await getChatLanguage(env.DB, ctx.chat?.id || 0);
        draft.fromId = Number(ctx.match[2]);
        await saveDraft(env.DB, draftId, draft);
        const members = await getProjectMembers(env.DB, draft.projectId);
        const receivers = members.filter(m => m.user_id !== draft.fromId);
        if (receivers.length === 0) {
          const kb = new InlineKeyboard().text(t.cancelBtn(lang), `canceldraft_${draftId}`);
          await ctx.editMessageText(t.noOtherMembersTransfer(lang), { parse_mode: "HTML", reply_markup: kb });
          return;
        }
        const kb = new InlineKeyboard();
        for (let i = 0; i < receivers.length; i++) {
          kb.text(receivers[i].name, `payto_${draftId}_${receivers[i].user_id}`);
          if (i % 2 === 1) kb.row();
        }
        if (receivers.length % 2 !== 0) kb.row();
        kb.text(t.cancelBtn(lang), `canceldraft_${draftId}`);
        await ctx.editMessageText(t.promptPayReceiver(lang, draft.amount), { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^payto_(pay_.+)_(-?\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = await getDraft(env.DB, draftId);
        if (!draft) return;
        const lang = draft.lang || await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const tItem = await env.DB.prepare("INSERT INTO settlements (project_id, from_user_id, to_user_id, amount) VALUES (?, ?, ?, ?) RETURNING id").bind(draft.projectId, draft.fromId, Number(ctx.match[2]), draft.amount).first() as any;
        await deleteDraft(env.DB, draftId);
        const currentMsgId = ctx.callbackQuery?.message?.message_id;
        const toDelete = (draft.msgIds || []).filter((id: any): id is number => typeof id === "number" && id > 0 && id !== currentMsgId);
        
        const proj = await getProjectById(env.DB, draft.projectId);
        const curr = proj?.currency ? ' ' + escapeHtml(proj.currency) : '';
        const members = await getProjectMembers(env.DB, draft.projectId);
        const fromMem = members.find(m => m.user_id === draft.fromId);
        const toMem = members.find(m => m.user_id === Number(ctx.match[2]));
        const fromName = fromMem?.name || "Unknown";
        const toName = toMem?.name || "Unknown";

        const kb = new InlineKeyboard()
          .text(t.undoBtn(lang), `delpay_${tItem.id}_${draft.projectId}`)
          .text(t.closeBtn(lang), "closemsg");
        await ctx.editMessageText(t.paymentRecorded(lang, fromName, toName, draft.amount, curr), { parse_mode: "HTML", reply_markup: kb });

        if (ctx.chat && toDelete.length > 0) {
          await deleteMessages(ctx, ctx.chat.id, toDelete);
        }
      });

      // --- DELETE / UNDO HANDLERS ---
      bot.callbackQuery(/^delexp_(\d+)_(\d+)$/, async (ctx) => {
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        await ctx.answerCallbackQuery(t.txDeletedAlert(lang)).catch(() => {});
        const expId = Number(ctx.match[1]);
        await env.DB.prepare("DELETE FROM expense_splits WHERE expense_id = ?").bind(expId).run();
        await env.DB.prepare("DELETE FROM expenses WHERE id = ?").bind(expId).run();
        const kb = new InlineKeyboard().text(t.closeBtn(lang), "closemsg");
        await ctx.editMessageText(t.expenseDeletedUndo(lang), { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^delpay_(\d+)_(\d+)$/, async (ctx) => {
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        await ctx.answerCallbackQuery(t.txDeletedAlert(lang)).catch(() => {});
        const payId = Number(ctx.match[1]);
        await env.DB.prepare("DELETE FROM settlements WHERE id = ?").bind(payId).run();
        const kb = new InlineKeyboard().text(t.closeBtn(lang), "closemsg");
        await ctx.editMessageText(t.paymentDeletedUndo(lang), { parse_mode: "HTML", reply_markup: kb });
      });

      // --- CALLBACKS FOR BALANCES, SETTLE, DELETE, REPORT & CLOSE ---
      bot.callbackQuery(/^selproj_bal_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;
        await showBalancesMenu(ctx, env.DB, Number(ctx.match[1]), cmdMsgId, lang);
      });

      async function showBalancesMenu(ctx: Context, db: D1Database, projId: number, cmdMsgId: number = 0, lang: Language = "en") {
        const members = await getProjectMembers(db, projId);
        const proj = await getProjectById(db, projId);
        if (!proj) return;
        if (members.length === 0) {
          const text = t.noMembersInProject(lang, proj.name);
          const kb = new InlineKeyboard().text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
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
        kb.text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");

        const text = t.balancesMenuTitle(lang, proj.name);
        if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
        else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
      }

      bot.callbackQuery(/^baluser_(\d+)_(-?\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const projId = Number(ctx.match[1]);
        const userId = Number(ctx.match[2]);
        const cmdMsgId = ctx.match[3] ? Number(ctx.match[3]) : 0;
        const proj = await getProjectById(env.DB, projId);
        if (!proj) return;
        const { netBalances, names, totalPaid, totalShare } = await calculateBalances(env.DB, projId);
        const myBal = netBalances[userId] || 0;
        const myName = names[userId] || "Member";
        
        let msg = `👤 <b>${escapeHtml(myName)}</b> — ${escapeHtml(proj.name)}\n\n`;
        const transactions = getSettlementTransactions(netBalances);
        const myDebts = transactions.filter(tr => tr.from === userId);
        const myCredits = transactions.filter(tr => tr.to === userId);

        if (myDebts.length > 0 || myCredits.length > 0) {
          msg += t.debtsSectionTitle(lang);
          myDebts.forEach(d => msg += t.debtLine(lang, `${d.amount.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`, names[d.to] || 'Unknown'));
          myCredits.forEach(c => msg += t.creditLine(lang, `${c.amount.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`, names[c.from] || 'Unknown'));
          msg += `\n`;
        } else {
          msg += t.noPendingDebts(lang);
        }

        msg += t.totalPaidLine(lang, `${totalPaid[userId]?.toFixed(2) || '0.00'}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`);
        msg += t.totalShareLine(lang, `${totalShare[userId]?.toFixed(2) || '0.00'}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`);
        msg += `------------------------------------\n`;
        if (myBal > 0.01) msg += t.netGetsBack(lang, `${myBal.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`);
        else if (myBal < -0.01) msg += t.netOwes(lang, `${myBal.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`);
        else msg += t.netSettled(lang);

        const expPaidRow = await env.DB.prepare("SELECT COUNT(*) as count FROM expenses WHERE project_id = ? AND payer_id = ?").bind(projId, userId).first() as any;
        const expSplitRow = await env.DB.prepare("SELECT COUNT(*) as count FROM expense_splits es JOIN expenses e ON es.expense_id = e.id WHERE e.project_id = ? AND es.user_id = ?").bind(projId, userId).first() as any;
        const setlRow = await env.DB.prepare("SELECT COUNT(*) as count FROM settlements WHERE project_id = ? AND (from_user_id = ? OR to_user_id = ?)").bind(projId, userId, userId).first() as any;

        const isNotInvolved = (expPaidRow?.count || 0) === 0 && (expSplitRow?.count || 0) === 0 && (setlRow?.count || 0) === 0;

        if (isNotInvolved) {
          msg += t.memberNotInvolvedNote(lang);
        }

        const backData = cmdMsgId ? `selproj_bal_${projId}_${cmdMsgId}` : `selproj_bal_${projId}`;
        const kb = new InlineKeyboard().text(t.backToMembersBtn(lang), backData);
        if (isNotInvolved && proj.status === 'active') {
          const rmData = cmdMsgId ? `askrm_mem_${projId}_${userId}_${cmdMsgId}` : `askrm_mem_${projId}_${userId}`;
          kb.text(t.removeMemberBtn(lang), rmData);
        }
        kb.row().text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        await ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^askrm_mem_(\d+)_(-?\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const projId = Number(ctx.match[1]);
        const userId = Number(ctx.match[2]);
        const cmdMsgId = ctx.match[3] ? Number(ctx.match[3]) : 0;

        const proj = await getProjectById(env.DB, projId);
        if (!proj) return;

        const members = await getProjectMembers(env.DB, projId);
        const member = members.find(m => m.user_id === userId);
        const memberName = member?.name || "Member";

        const cfmData = cmdMsgId ? `cfmrm_mem_${projId}_${userId}_${cmdMsgId}` : `cfmrm_mem_${projId}_${userId}`;
        const cancelData = cmdMsgId ? `baluser_${projId}_${userId}_${cmdMsgId}` : `baluser_${projId}_${userId}`;

        const confirmText = t.askRemoveMember(lang, memberName, proj.name);

        const kb = new InlineKeyboard()
          .text(t.yesRemoveMemberBtn(lang), cfmData)
          .text(t.cancelBtn(lang), cancelData)
          .row()
          .text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");

        await ctx.editMessageText(confirmText, { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^cfmrm_mem_(\d+)_(-?\d+)(?:_(\d+))?$/, async (ctx) => {
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const projId = Number(ctx.match[1]);
        const userId = Number(ctx.match[2]);
        const cmdMsgId = ctx.match[3] ? Number(ctx.match[3]) : 0;

        const proj = await getProjectById(env.DB, projId);
        if (!proj) return;

        const expPaidRow = await env.DB.prepare("SELECT COUNT(*) as count FROM expenses WHERE project_id = ? AND payer_id = ?").bind(projId, userId).first() as any;
        const expSplitRow = await env.DB.prepare("SELECT COUNT(*) as count FROM expense_splits es JOIN expenses e ON es.expense_id = e.id WHERE e.project_id = ? AND es.user_id = ?").bind(projId, userId).first() as any;
        const setlRow = await env.DB.prepare("SELECT COUNT(*) as count FROM settlements WHERE project_id = ? AND (from_user_id = ? OR to_user_id = ?)").bind(projId, userId, userId).first() as any;

        const isNotInvolved = (expPaidRow?.count || 0) === 0 && (expSplitRow?.count || 0) === 0 && (setlRow?.count || 0) === 0;
        if (!isNotInvolved) {
          await ctx.answerCallbackQuery(t.cannotRemoveHasTx(lang)).catch(() => {});
          const backData = cmdMsgId ? `baluser_${projId}_${userId}_${cmdMsgId}` : `baluser_${projId}_${userId}`;
          const kb = new InlineKeyboard().text(t.backBtn(lang), backData);
          return ctx.editMessageText(t.cannotRemoveHasTxBody(lang), { parse_mode: "HTML", reply_markup: kb });
        }

        const members = await getProjectMembers(env.DB, projId);
        const member = members.find(m => m.user_id === userId);
        const memberName = member?.name || "Member";

        await env.DB.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").bind(projId, userId).run();
        await ctx.answerCallbackQuery(t.memberRemovedAlert(lang)).catch(() => {});

        const backData = cmdMsgId ? `selproj_bal_${projId}_${cmdMsgId}` : `selproj_bal_${projId}`;
        const kb = new InlineKeyboard()
          .text(t.backToMembersBtn(lang), backData)
          .row()
          .text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");

        await ctx.editMessageText(t.memberRemovedSuccess(lang, memberName, proj.name), { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^selproj_settle_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;
        await showSettlement(ctx, env.DB, Number(ctx.match[1]), cmdMsgId, lang);
      });

      async function showSettlement(ctx: Context, db: D1Database, projId: number, cmdMsgId: number = 0, lang: Language = "en") {
        const proj = await getProjectById(db, projId);
        if (!proj) return;
        const { netBalances, names } = await calculateBalances(db, projId);
        const steps = solveSettlement(netBalances, names, proj.currency, lang);
        let report = t.settlePlanTitle(lang, proj.name);
        if (steps.length === 0) report += t.allSettledUp(lang);
        else report += steps.join("\n") + t.settleTip(lang);
        const kb = new InlineKeyboard().text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        if (ctx.callbackQuery) await ctx.editMessageText(report, { parse_mode: "HTML", reply_markup: kb });
        else await ctx.reply(report, { parse_mode: "HTML", reply_markup: kb });
      }

      // --- TRANSACTIONS HANDLERS ---
      bot.callbackQuery(/^selproj_tx_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;
        await showTransactionsMenu(ctx, env.DB, Number(ctx.match[1]), 1, cmdMsgId, lang);
      });

      bot.callbackQuery(/^selproj_delete_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;
        await showTransactionsMenu(ctx, env.DB, Number(ctx.match[1]), 1, cmdMsgId, lang);
      });

      bot.callbackQuery(/^txpage_(\d+)_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const projId = Number(ctx.match[1]);
        const page = Number(ctx.match[2]);
        const cmdMsgId = ctx.match[3] ? Number(ctx.match[3]) : 0;
        await showTransactionsMenu(ctx, env.DB, projId, page, cmdMsgId, lang);
      });

      bot.callbackQuery(/^tx_noop$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
      });

      async function showTransactionsMenu(ctx: Context, db: D1Database, projId: number, page: number = 1, cmdMsgId: number = 0, lang: Language = "en") {
        const proj = await getProjectById(db, projId);
        if (!proj) return;
        const members = await getProjectMembers(db, projId);
        const memberMap = new Map<number, string>(members.map(m => [m.user_id, m.name]));

        const { results: exps } = await db.prepare(
          "SELECT id, payer_id, amount, description, created_at FROM expenses WHERE project_id = ? ORDER BY id DESC"
        ).bind(projId).all();

        const { results: pays } = await db.prepare(
          "SELECT id, from_user_id, to_user_id, amount, created_at FROM settlements WHERE project_id = ? ORDER BY id DESC"
        ).bind(projId).all();

        type TxItem = {
          type: "exp" | "pay";
          id: number;
          amount: number;
          createdAt: string;
          label: string;
        };

        const list: TxItem[] = [];

        for (const e of (exps as any[])) {
          const fallbackDesc = lang === "fa" ? "هزینه" : "Expense";
          const desc = e.description ? (e.description.length > 18 ? e.description.slice(0, 18) + "…" : e.description) : fallbackDesc;
          list.push({
            type: "exp",
            id: e.id,
            amount: e.amount,
            createdAt: e.created_at || "",
            label: `🧾 ${desc} (${e.amount}${proj.currency ? ' ' + proj.currency : ''})`
          });
        }

        for (const s of (pays as any[])) {
          const fromName = memberMap.get(s.from_user_id) || "Unknown";
          const toName = memberMap.get(s.to_user_id) || "Unknown";
          const shortFrom = fromName.length > 8 ? fromName.slice(0, 8) + "…" : fromName;
          const shortTo = toName.length > 8 ? toName.slice(0, 8) + "…" : toName;
          const toWord = lang === "fa" ? "به" : "to";
          list.push({
            type: "pay",
            id: s.id,
            amount: s.amount,
            createdAt: s.created_at || "",
            label: `\u200E💸 ${shortFrom} ${toWord} ${shortTo} (${s.amount}${proj.currency ? ' ' + proj.currency : ''})`
          });
        }

        list.sort((a, b) => {
          if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) {
            return b.createdAt.localeCompare(a.createdAt);
          }
          return b.id - a.id;
        });

        const kb = new InlineKeyboard();

        if (list.length === 0) {
          const text = t.noTransactionsYet(lang, proj.name);
          kb.text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
          if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
          else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
          return;
        }

        const PAGE_SIZE = 6;
        const totalItems = list.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
        const currentPage = Math.max(1, Math.min(page, totalPages));
        const startIndex = (currentPage - 1) * PAGE_SIZE;
        const pageItems = list.slice(startIndex, startIndex + PAGE_SIZE);

        for (const item of pageItems) {
          const callbackData = item.type === "exp"
            ? (cmdMsgId ? `tx_exp_${item.id}_${projId}_${currentPage}_${cmdMsgId}` : `tx_exp_${item.id}_${projId}_${currentPage}`)
            : (cmdMsgId ? `tx_pay_${item.id}_${projId}_${currentPage}_${cmdMsgId}` : `tx_pay_${item.id}_${projId}_${currentPage}`);
          kb.text(item.label, callbackData).row();
        }

        if (totalPages > 1) {
          if (currentPage > 1) {
            const prevData = cmdMsgId
              ? `txpage_${projId}_${currentPage - 1}_${cmdMsgId}`
              : `txpage_${projId}_${currentPage - 1}`;
            kb.text(t.prevPageBtn(lang), prevData);
          }
          kb.text(`📄 ${currentPage}/${totalPages}`, "tx_noop");
          if (currentPage < totalPages) {
            const nextData = cmdMsgId
              ? `txpage_${projId}_${currentPage + 1}_${cmdMsgId}`
              : `txpage_${projId}_${currentPage + 1}`;
            kb.text(t.nextPageBtn(lang), nextData);
          }
          kb.row();
        }

        kb.text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");

        const text = t.txMenuTitle(lang, proj.name, currentPage, totalPages);
        if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
        else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
      }

      bot.callbackQuery(/^tx_exp_(\d+)_(\d+)_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const expId = Number(ctx.match[1]);
        const projId = Number(ctx.match[2]);
        const page = Number(ctx.match[3]);
        const cmdMsgId = ctx.match[4] ? Number(ctx.match[4]) : 0;

        const proj = await getProjectById(env.DB, projId);
        if (!proj) return;

        const exp = await env.DB.prepare("SELECT * FROM expenses WHERE id = ? AND project_id = ?").bind(expId, projId).first() as any;
        const backData = cmdMsgId ? `txpage_${projId}_${page}_${cmdMsgId}` : `txpage_${projId}_${page}`;

        if (!exp) {
          const kb = new InlineKeyboard().text(t.backToTransactionsBtn(lang), backData).row().text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
          return ctx.editMessageText(t.expenseNotFound(lang), { parse_mode: "HTML", reply_markup: kb });
        }

        const members = await getProjectMembers(env.DB, projId);
        const payer = members.find(m => m.user_id === exp.payer_id);
        const payerName = payer?.name || "Unknown";

        const { results: splits } = await env.DB.prepare(
          "SELECT user_id, share_amount FROM expense_splits WHERE expense_id = ?"
        ).bind(expId).all();

        const amtStr = `${exp.amount}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`;
        let msg = t.txExpenseDetails(lang, exp.description, payerName, amtStr, exp.created_at || "");

        if (!splits || splits.length === 0) {
          msg += lang === 'fa' ? `<i>تقسیم مساوی بین تمامی اعضا.</i>\n` : `<i>Equal split amongst all members.</i>\n`;
        } else {
          for (const s of (splits as any[])) {
            const m = members.find(mem => mem.user_id === s.user_id);
            const mName = m?.name || "Unknown";
            msg += `\u200E• <b>${escapeHtml(mName)}:</b> ${s.share_amount}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}\n`;
          }
        }

        const askDelData = cmdMsgId ? `tx_askdel_exp_${exp.id}_${projId}_${page}_${cmdMsgId}` : `tx_askdel_exp_${exp.id}_${projId}_${page}`;
        const kb = new InlineKeyboard()
          .text(t.backBtn(lang), backData)
          .text(t.deleteBtn(lang), askDelData)
          .row()
          .text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");

        await ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^tx_pay_(\d+)_(\d+)_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const payId = Number(ctx.match[1]);
        const projId = Number(ctx.match[2]);
        const page = Number(ctx.match[3]);
        const cmdMsgId = ctx.match[4] ? Number(ctx.match[4]) : 0;

        const proj = await getProjectById(env.DB, projId);
        if (!proj) return;

        const pay = await env.DB.prepare("SELECT * FROM settlements WHERE id = ? AND project_id = ?").bind(payId, projId).first() as any;
        const backData = cmdMsgId ? `txpage_${projId}_${page}_${cmdMsgId}` : `txpage_${projId}_${page}`;

        if (!pay) {
          const kb = new InlineKeyboard().text(t.backToTransactionsBtn(lang), backData).row().text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
          return ctx.editMessageText(t.paymentNotFound(lang), { parse_mode: "HTML", reply_markup: kb });
        }

        const members = await getProjectMembers(env.DB, projId);
        const sender = members.find(m => m.user_id === pay.from_user_id);
        const receiver = members.find(m => m.user_id === pay.to_user_id);
        const senderName = sender?.name || "Unknown";
        const receiverName = receiver?.name || "Unknown";

        const amtStr = `${pay.amount}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`;
        const msg = t.txPaymentDetails(lang, senderName, receiverName, amtStr, pay.created_at || "");

        const askDelData = cmdMsgId ? `tx_askdel_pay_${pay.id}_${projId}_${page}_${cmdMsgId}` : `tx_askdel_pay_${pay.id}_${projId}_${page}`;
        const kb = new InlineKeyboard()
          .text(t.backBtn(lang), backData)
          .text(t.deleteBtn(lang), askDelData)
          .row()
          .text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");

        await ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^tx_askdel_exp_(\d+)_(\d+)_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const expId = Number(ctx.match[1]);
        const projId = Number(ctx.match[2]);
        const page = Number(ctx.match[3]);
        const cmdMsgId = ctx.match[4] ? Number(ctx.match[4]) : 0;

        const proj = await getProjectById(env.DB, projId);
        if (!proj) return;

        const exp = await env.DB.prepare("SELECT * FROM expenses WHERE id = ? AND project_id = ?").bind(expId, projId).first() as any;
        const detailData = cmdMsgId ? `tx_exp_${expId}_${projId}_${page}_${cmdMsgId}` : `tx_exp_${expId}_${projId}_${page}`;

        if (!exp) {
          const backData = cmdMsgId ? `txpage_${projId}_${page}_${cmdMsgId}` : `txpage_${projId}_${page}`;
          const kb = new InlineKeyboard().text(t.backToTransactionsBtn(lang), backData).row().text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
          return ctx.editMessageText(t.expenseNotFound(lang), { parse_mode: "HTML", reply_markup: kb });
        }

        const cfmData = cmdMsgId ? `tx_cfmdel_exp_${expId}_${projId}_${page}_${cmdMsgId}` : `tx_cfmdel_exp_${expId}_${projId}_${page}`;
        const kb = new InlineKeyboard()
          .text(t.yesDeleteBtn(lang), cfmData)
          .text(t.cancelBtn(lang), detailData)
          .row()
          .text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");

        const amtStr = `${exp.amount}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`;
        const confirmMsg = t.askDeleteExpense(lang, exp.description, amtStr);

        await ctx.editMessageText(confirmMsg, { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^tx_askdel_pay_(\d+)_(\d+)_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const payId = Number(ctx.match[1]);
        const projId = Number(ctx.match[2]);
        const page = Number(ctx.match[3]);
        const cmdMsgId = ctx.match[4] ? Number(ctx.match[4]) : 0;

        const proj = await getProjectById(env.DB, projId);
        if (!proj) return;

        const pay = await env.DB.prepare("SELECT * FROM settlements WHERE id = ? AND project_id = ?").bind(payId, projId).first() as any;
        const detailData = cmdMsgId ? `tx_pay_${payId}_${projId}_${page}_${cmdMsgId}` : `tx_pay_${payId}_${projId}_${page}`;

        if (!pay) {
          const backData = cmdMsgId ? `txpage_${projId}_${page}_${cmdMsgId}` : `txpage_${projId}_${page}`;
          const kb = new InlineKeyboard().text(t.backToTransactionsBtn(lang), backData).row().text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
          return ctx.editMessageText(t.paymentNotFound(lang), { parse_mode: "HTML", reply_markup: kb });
        }

        const members = await getProjectMembers(env.DB, projId);
        const sender = members.find(m => m.user_id === pay.from_user_id);
        const receiver = members.find(m => m.user_id === pay.to_user_id);
        const senderName = sender?.name || "Unknown";
        const receiverName = receiver?.name || "Unknown";

        const cfmData = cmdMsgId ? `tx_cfmdel_pay_${payId}_${projId}_${page}_${cmdMsgId}` : `tx_cfmdel_pay_${payId}_${projId}_${page}`;
        const kb = new InlineKeyboard()
          .text(t.yesDeleteBtn(lang), cfmData)
          .text(t.cancelBtn(lang), detailData)
          .row()
          .text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");

        const amtStr = `${pay.amount}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`;
        const confirmMsg = t.askDeletePayment(lang, senderName, receiverName, amtStr);

        await ctx.editMessageText(confirmMsg, { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^tx_cfmdel_exp_(\d+)_(\d+)_(\d+)(?:_(\d+))?$/, async (ctx) => {
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        await ctx.answerCallbackQuery(t.txDeletedAlert(lang)).catch(() => {});
        const expId = Number(ctx.match[1]);
        const projId = Number(ctx.match[2]);
        const page = Number(ctx.match[3]);
        const cmdMsgId = ctx.match[4] ? Number(ctx.match[4]) : 0;

        await env.DB.prepare("DELETE FROM expense_splits WHERE expense_id = ?").bind(expId).run();
        await env.DB.prepare("DELETE FROM expenses WHERE id = ?").bind(expId).run();

        const backData = cmdMsgId ? `txpage_${projId}_${page}_${cmdMsgId}` : `txpage_${projId}_${page}`;
        const kb = new InlineKeyboard()
          .text(t.backToTransactionsBtn(lang), backData)
          .row()
          .text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");

        await ctx.editMessageText(t.expenseDeletedPermanently(lang), { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^tx_cfmdel_pay_(\d+)_(\d+)_(\d+)(?:_(\d+))?$/, async (ctx) => {
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        await ctx.answerCallbackQuery(t.txDeletedAlert(lang)).catch(() => {});
        const payId = Number(ctx.match[1]);
        const projId = Number(ctx.match[2]);
        const page = Number(ctx.match[3]);
        const cmdMsgId = ctx.match[4] ? Number(ctx.match[4]) : 0;

        await env.DB.prepare("DELETE FROM settlements WHERE id = ?").bind(payId).run();

        const backData = cmdMsgId ? `txpage_${projId}_${page}_${cmdMsgId}` : `txpage_${projId}_${page}`;
        const kb = new InlineKeyboard()
          .text(t.backToTransactionsBtn(lang), backData)
          .row()
          .text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");

        await ctx.editMessageText(t.paymentDeletedPermanently(lang), { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^selproj_report_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;
        await showReport(ctx, env.DB, Number(ctx.match[1]), cmdMsgId, lang);
      });

      async function showReport(ctx: Context, db: D1Database, projId: number, cmdMsgId: number = 0, lang: Language = "en") {
        const proj = await getProjectById(db, projId);
        if (!proj) return;
        const { netBalances, totalPaid, members } = await calculateBalances(db, projId);

        const expSumRow = await db.prepare("SELECT SUM(amount) as total, COUNT(id) as count FROM expenses WHERE project_id = ?").bind(projId).first() as any;
        const totalExp = expSumRow?.total || 0;
        const countExp = expSumRow?.count || 0;

        const totalStr = `${totalExp.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`;
        let msg = t.reportHeader(lang, proj.name, proj.status.toUpperCase(), totalStr, countExp);
        
        for (const m of members) {
          const paid = totalPaid[m.user_id] || 0;
          const bal = netBalances[m.user_id] || 0;
          const paidStr = `${paid.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`;
          const balStr = `${bal >= 0 ? "+" : ""}${bal.toFixed(2)}`;
          msg += t.reportMemberLine(lang, m.name, paidStr, balStr);
        }

        const kb = new InlineKeyboard();
        const balData = cmdMsgId ? `selproj_bal_${projId}_${cmdMsgId}` : `selproj_bal_${projId}`;
        kb.text(t.viewMembersBtn(lang), balData);
        if (proj.status === "ended") {
          const askDelData = cmdMsgId ? `askdel_proj_${projId}_${cmdMsgId}` : `askdel_proj_${projId}`;
          kb.text(t.deleteProjectBtn(lang), askDelData).row();
        } else {
          const closeData = cmdMsgId ? `closeproj_${projId}_${cmdMsgId}` : `closeproj_${projId}`;
          kb.text(t.closeProjectBtn(lang), closeData).row();
        }
        kb.text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        if (ctx.callbackQuery) await ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb });
        else await ctx.reply(msg, { parse_mode: "HTML", reply_markup: kb });
      }

      bot.callbackQuery(/^askdel_proj_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const projId = Number(ctx.match[1]);
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;

        const proj = await getProjectById(env.DB, projId);
        if (!proj) return;

        const cfmData = cmdMsgId ? `cfmdel_proj_${projId}_${cmdMsgId}` : `cfmdel_proj_${projId}`;
        const cancelData = ctx.chat?.type === "private"
          ? `pv_proj_${projId}`
          : (cmdMsgId ? `selproj_report_${projId}_${cmdMsgId}` : `selproj_report_${projId}`);

        const confirmText = t.askDeleteProject(lang, proj.name);

        const kb = new InlineKeyboard()
          .text(t.yesDeleteProjectBtn(lang), cfmData)
          .text(t.cancelBtn(lang), cancelData)
          .row()
          .text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");

        await ctx.editMessageText(confirmText, { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^cfmdel_proj_(\d+)(?:_(\d+))?$/, async (ctx) => {
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const projId = Number(ctx.match[1]);
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;

        const proj = await getProjectById(env.DB, projId);
        if (!proj) return;

        await env.DB.prepare("DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE project_id = ?)").bind(projId).run();
        await env.DB.prepare("DELETE FROM expenses WHERE project_id = ?").bind(projId).run();
        await env.DB.prepare("DELETE FROM settlements WHERE project_id = ?").bind(projId).run();
        await env.DB.prepare("DELETE FROM project_members WHERE project_id = ?").bind(projId).run();
        await env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(projId).run();

        await ctx.answerCallbackQuery(t.projectDeletedAlert(lang)).catch(() => {});

        const kb = new InlineKeyboard().text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        await ctx.editMessageText(t.projectDeletedSuccess(lang, proj.name), { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^closeproj_(\d+)(?:_(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        const projId = Number(ctx.match[1]);
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;
        const proj = await getProjectById(env.DB, projId);
        if (!proj) return;
        const { netBalances } = await calculateBalances(env.DB, projId);

        const backData = ctx.chat?.type === "private"
          ? `pv_proj_${projId}`
          : (cmdMsgId ? `selproj_report_${projId}_${cmdMsgId}` : `selproj_report_${projId}`);

        const unsettled = Object.values(netBalances).some(b => Math.abs(b) > 0.01);
        if (unsettled) {
          const cfmData = cmdMsgId ? `cfmclose_proj_${projId}_${cmdMsgId}` : `cfmclose_proj_${projId}`;
          const kb = new InlineKeyboard()
            .text(t.yesCloseAnywayBtn(lang), cfmData)
            .text(t.cancelBtn(lang), backData)
            .row()
            .text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
          return ctx.editMessageText(
            t.askCloseUnsettled(lang, proj.name),
            { parse_mode: "HTML", reply_markup: kb }
          );
        }

        await env.DB.prepare("UPDATE projects SET status = 'ended' WHERE id = ?").bind(projId).run();
        const kb = new InlineKeyboard()
          .text(t.backToProjectBtn(lang), backData)
          .row()
          .text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        await ctx.editMessageText(t.projectClosedSuccess(lang, proj.name), { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery(/^cfmclose_proj_(\d+)(?:_(\d+))?$/, async (ctx) => {
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        await ctx.answerCallbackQuery(t.projectClosedAlert(lang)).catch(() => {});
        const projId = Number(ctx.match[1]);
        const cmdMsgId = ctx.match[2] ? Number(ctx.match[2]) : 0;
        const proj = await getProjectById(env.DB, projId);
        if (!proj) return;

        await env.DB.prepare("UPDATE projects SET status = 'ended' WHERE id = ?").bind(projId).run();
        const backData = ctx.chat?.type === "private"
          ? `pv_proj_${projId}`
          : (cmdMsgId ? `selproj_report_${projId}_${cmdMsgId}` : `selproj_report_${projId}`);

        const kb = new InlineKeyboard()
          .text(t.backToProjectBtn(lang), backData)
          .row()
          .text(t.closeBtn(lang), cmdMsgId ? `closeflow_${cmdMsgId}` : "closemsg");
        await ctx.editMessageText(t.projectClosedSuccess(lang, proj.name), { parse_mode: "HTML", reply_markup: kb });
      });

      // --- PRIVATE CHAT (PV) NAVIGATION CALLBACKS ---
      bot.callbackQuery(/^pv_proj_(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || ctx.from.id);
        const projId = Number(ctx.match[1]);
        const proj = await getProjectById(env.DB, projId);
        if (!proj) return;
        const userId = ctx.from.id;
        const { netBalances, names, totalPaid, totalShare } = await calculateBalances(env.DB, projId);
        const myBal = netBalances[userId] || 0;
        const statusText = t.pvStatusLabel(lang, proj.status);

        let msg = `📁 <b>${escapeHtml(proj.name)}</b> (${statusText})\n\n`;
        const transactions = getSettlementTransactions(netBalances);
        const myDebts = transactions.filter(tr => tr.from === userId);
        const myCredits = transactions.filter(tr => tr.to === userId);

        if (myDebts.length > 0 || myCredits.length > 0) {
          msg += t.pvDebtsInProject(lang);
          myDebts.forEach(d => msg += t.pvYouOwe(lang, `${d.amount.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`, names[d.to] || 'Unknown'));
          myCredits.forEach(c => msg += t.pvYouGet(lang, `${c.amount.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`, names[c.from] || 'Unknown'));
          msg += `\n`;
        } else {
          msg += t.pvNoPendingDebtsProj(lang);
        }

        msg += t.pvTotalPaid(lang, `${totalPaid[userId]?.toFixed(2) || '0.00'}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`);
        msg += t.pvYourShare(lang, `${totalShare[userId]?.toFixed(2) || '0.00'}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`);
        msg += `------------------------------------\n`;
        if (myBal > 0.01) msg += t.pvNetTotalGetsBack(lang, `${myBal.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`);
        else if (myBal < -0.01) msg += t.pvNetTotalOwes(lang, `${myBal.toFixed(2)}${proj.currency ? ' ' + escapeHtml(proj.currency) : ''}`);
        else msg += t.pvNetTotalSettled(lang);

        const kb = new InlineKeyboard()
          .text(t.viewTransactionsBtn(lang), `selproj_tx_${projId}`).row();
        if (proj.status === "ended") {
          kb.text(t.deleteProjectBtn(lang), `askdel_proj_${projId}_0`).row();
        } else {
          kb.text(t.closeProjectBtn(lang), `closeproj_${projId}_0`).row();
        }
        kb.text(t.pvBackBalBtn(lang), "pv_back_bal")
          .text(t.pvBackProjBtn(lang), "pv_back_proj");
        await ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb });
      });

      bot.callbackQuery("pv_back_bal", async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        if (ctx.chat?.type === "private") {
          const lang = await getChatLanguage(env.DB, ctx.chat.id);
          await ctx.deleteMessage().catch(() => {});
          await showPrivateBalances(ctx, lang);
        }
      });

      bot.callbackQuery("pv_back_proj", async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        if (ctx.chat?.type === "private") {
          const lang = await getChatLanguage(env.DB, ctx.chat.id);
          await ctx.deleteMessage().catch(() => {});
          await showPrivateProjects(ctx, lang);
        }
      });

      // --- DISMISSAL / CLEANUP HANDLERS ---
      bot.callbackQuery(/^canceldraft_(.+)$/, async (ctx) => {
        const lang = await getChatLanguage(env.DB, ctx.chat?.id || 0);
        await ctx.answerCallbackQuery(t.actionCancelled(lang)).catch(() => {});
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