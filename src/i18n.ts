export type Language = 'en' | 'fa';

export function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const t = {
  // Language switcher
  langBtnEn: () => '🇬🇧 English',
  langBtnFa: () => '🇮🇷 فارسی',
  chooseLangPrompt: () =>
    `🌐 <b>Choose Bot Language / انتخاب زبان ربات:</b>\n\nSelect the language for bot messages in this chat:\nزبان پیام‌های ربات در این گفتگو را انتخاب کنید:`,
  langChanged: (lang: Language) =>
    lang === 'fa'
      ? `✅ زبان ربات با موفقیت روی <b>فارسی</b> تنظیم شد.`
      : `✅ Language set to <b>English</b>.`,

  // Common UI Buttons
  closeBtn: (lang: Language) => (lang === 'fa' ? '❌ بستن' : '❌ Close'),
  cancelBtn: (lang: Language) => (lang === 'fa' ? '❌ انصراف' : '❌ Cancel'),
  skipBtn: (lang: Language) => (lang === 'fa' ? '⏩ رد کردن' : '⏩ Skip'),
  backBtn: (lang: Language) => (lang === 'fa' ? '« بازگشت' : '« Back'),
  undoBtn: (lang: Language) => (lang === 'fa' ? '↩️ لغو ثبت' : '↩️ Undo'),
  deleteBtn: (lang: Language) => (lang === 'fa' ? '🗑️ حذف' : '🗑️ Delete'),
  yesDeleteBtn: (lang: Language) => (lang === 'fa' ? '🗑️ بله، حذف شود' : '🗑️ Yes, Delete'),
  joinProjectBtn: (lang: Language) => (lang === 'fa' ? '✋ عضویت در پروژه' : '✋ Join Project'),
  doneAddingBtn: (lang: Language) => (lang === 'fa' ? '✅ اتمام افزودن' : '✅ Done Adding'),
  unequalShareBtn: (lang: Language) => (lang === 'fa' ? '⚡ سهم نامساوی' : '⚡ Unequal Share'),
  unequalSplitBtn: (lang: Language) => (lang === 'fa' ? '⚡ دانگ نامساوی' : '⚡ Unequal Split'),
  enterSharesBtn: (lang: Language) => (lang === 'fa' ? '⚡ ورود سهم‌ها ➡️' : '⚡ Enter Shares ➡️'),
  confirmEqualBtn: (lang: Language) => (lang === 'fa' ? '💾 تایید تقسیم مساوی' : '💾 Confirm Equal'),
  restartSharesBtn: (lang: Language) => (lang === 'fa' ? '🔄 ثبت مجدد سهم‌ها' : '🔄 Restart Shares'),
  setTotalToBtn: (lang: Language, sum: number) =>
    lang === 'fa' ? `✅ ثبت مبلغ کل روی ${sum}` : `✅ Set Total to ${sum}`,
  viewMembersBtn: (lang: Language) => (lang === 'fa' ? '👥 مشاهده اعضا' : '👥 View Members'),
  closeProjectBtn: (lang: Language) => (lang === 'fa' ? '🔒 بستن پروژه' : '🔒 Close Project'),
  yesCloseAnywayBtn: (lang: Language) => (lang === 'fa' ? '🔒 بله، به هر حال بسته شود' : '🔒 Yes, Close Anyway'),
  deleteProjectBtn: (lang: Language) => (lang === 'fa' ? '🗑️ حذف پروژه' : '🗑️ Delete Project'),
  yesDeleteProjectBtn: (lang: Language) => (lang === 'fa' ? '🗑️ بله، پروژه حذف شود' : '🗑️ Yes, Delete Project'),
  removeMemberBtn: (lang: Language) => (lang === 'fa' ? '🚫 حذف عضو' : '🚫 Remove Member'),
  yesRemoveMemberBtn: (lang: Language) => (lang === 'fa' ? '🚫 بله، حذف شود' : '🚫 Yes, Remove'),
  backToMembersBtn: (lang: Language) => (lang === 'fa' ? '« بازگشت به اعضا' : '« Back to Members'),
  backToTransactionsBtn: (lang: Language) => (lang === 'fa' ? '« بازگشت به تراکنش‌ها' : '« Back to Transactions'),
  backToProjectBtn: (lang: Language) => (lang === 'fa' ? '« بازگشت به پروژه' : '« Back to Project'),
  prevPageBtn: (lang: Language) => (lang === 'fa' ? '⬅️ قبلی' : '⬅️ Prev'),
  nextPageBtn: (lang: Language) => (lang === 'fa' ? 'بعدی ➡️' : 'Next ➡️'),
  myBalancesBtn: (lang: Language) => (lang === 'fa' ? '👤 حساب من' : '👤 My Balances'),
  myProjectsBtn: (lang: Language) => (lang === 'fa' ? '📁 پروژه‌های من' : '📁 My Projects'),
  transactionsBtn: (lang: Language) => (lang === 'fa' ? '🧾 تراکنش‌ها' : '🧾 Transactions'),
  helpGuideBtn: (lang: Language) => (lang === 'fa' ? '❓ راهنما' : '❓ Help & Guide'),
  viewTransactionsBtn: (lang: Language) => (lang === 'fa' ? '🧾 مشاهده تراکنش‌ها' : '🧾 View Transactions'),

  // Alerts & Notifications
  joinedAlert: (lang: Language) => (lang === 'fa' ? 'به پروژه اضافه شدید!' : 'Joined!'),
  projectDeletedAlert: (lang: Language) => (lang === 'fa' ? 'پروژه برای همیشه حذف شد!' : 'Project permanently deleted!'),
  projectClosedAlert: (lang: Language) => (lang === 'fa' ? 'پروژه بسته شد!' : 'Project closed!'),
  memberRemovedAlert: (lang: Language) => (lang === 'fa' ? 'عضو از پروژه حذف شد!' : 'Member removed from project!'),
  txDeletedAlert: (lang: Language) => (lang === 'fa' ? 'تراکنش برای همیشه حذف شد!' : 'Transaction permanently deleted!'),
  selectAtLeastOne: (lang: Language) => (lang === 'fa' ? 'حداقل ۱ نفر را انتخاب کنید!' : 'Select at least 1 person!'),
  useUnequalToEnterShares: (lang: Language) =>
    lang === 'fa' ? 'لطفاً از دکمه دانگ نامساوی برای ورود سهم‌ها استفاده کنید!' : 'Please use Unequal Split to enter shares!',
  cannotRemoveHasTx: (lang: Language) =>
    lang === 'fa' ? 'امکان حذف وجود ندارد: این عضو دارای تراکنش ثبت‌شده است!' : 'Cannot remove: member has recorded transactions!',
  unequalModeNotice: (lang: Language) =>
    lang === 'fa'
      ? '⚡ <b>حالت دانگ نامساوی</b> (مبلغ کل بر اساس سهم تک‌تک افراد محاسبه می‌شود)'
      : '⚡ <b>Unequal Share Mode</b> (Total will be calculated from individual shares)',
  enteringSharesBelow: (lang: Language) =>
    lang === 'fa' ? '⚡ <i>در حال دریافت سهم‌های نامساوی در پیام‌های زیر...</i>' : '⚡ <i>Entering unequal shares below...</i>',

  // General & Errors
  noActiveProjects: (lang: Language) => (lang === 'fa' ? '❌ هیچ پروژه فعالی وجود ندارد.' : '❌ No active projects.'),
  chooseProject: (lang: Language) => (lang === 'fa' ? '📁 یک پروژه را انتخاب کنید:' : '📁 Choose a project:'),
  sessionExpired: (lang: Language) =>
    lang === 'fa' ? '❌ نشست منقضی شده است. لطفاً دوباره تلاش کنید.' : '❌ Session expired. Please try again.',
  actionCancelled: (lang: Language) => (lang === 'fa' ? '❌ عملیات لغو شد.' : '❌ Action cancelled.'),
  missingProjectName: (lang: Language) =>
    lang === 'fa' ? '❌ لطفاً نام پروژه را وارد کنید.' : '❌ Missing project name.',
  missingExpenseAmount: (lang: Language) =>
    lang === 'fa' ? '❌ لطفاً مبلغ هزینه را وارد کنید.' : '❌ Missing expense amount.',
  missingPaymentAmount: (lang: Language) =>
    lang === 'fa' ? '❌ لطفاً مبلغ پرداختی را وارد کنید.' : '❌ Missing payment amount.',
  invalidMathOrAmount: (lang: Language, expr: string) =>
    lang === 'fa'
      ? `❌ محاسبه یا مبلغ نامعتبر است: '<code>${escapeHtml(expr)}</code>'`
      : `❌ Invalid math or amount: '<code>${escapeHtml(expr)}</code>'`,
  projectCancelled: (lang: Language) =>
    lang === 'fa' ? '❌ ایجاد پروژه لغو شد.' : '❌ Project creation cancelled.',
  expenseCancelled: (lang: Language) =>
    lang === 'fa' ? '❌ ثبت هزینه لغو شد.' : '❌ Expense cancelled.',
  paymentCancelled: (lang: Language) =>
    lang === 'fa' ? '❌ ثبت پرداخت لغو شد.' : '❌ Payment cancelled.',
  totalZeroCancelled: (lang: Language) =>
    lang === 'fa' ? '❌ مبلغ کل هزینه صفر است. ثبت هزینه لغو شد.' : '❌ Total expense amount is 0. Expense cancelled.',
  cannotRemoveHasTxBody: (lang: Language) =>
    lang === 'fa'
      ? '❌ <b>امکان حذف عضو وجود ندارد:</b>\nاین عضو در هزینه‌ها یا پرداخت‌ها مشارکت داشته و قابل حذف نیست.'
      : '❌ <b>Cannot remove member:</b>\nThis member has recorded expenses or transfers and cannot be removed.',
  expenseNotFound: (lang: Language) =>
    lang === 'fa' ? '❌ <i>این هزینه قبلاً حذف شده یا یافت نشد.</i>' : '❌ <i>This expense was already deleted or not found.</i>',
  paymentNotFound: (lang: Language) =>
    lang === 'fa' ? '❌ <i>این پرداخت قبلاً حذف شده یا یافت نشد.</i>' : '❌ <i>This payment was already deleted or not found.</i>',
  expenseDeletedUndo: (lang: Language) =>
    lang === 'fa' ? '🗑️ <i>هزینه با موفقیت حذف شد.</i>' : '🗑️ <i>Expense deleted successfully.</i>',
  paymentDeletedUndo: (lang: Language) =>
    lang === 'fa' ? '🗑️ <i>پرداخت با موفقیت حذف شد.</i>' : '🗑️ <i>Payment deleted successfully.</i>',
  noOtherMembersTransfer: (lang: Language) =>
    lang === 'fa' ? '❌ <b>عضو دیگری برای انتقال وجود ندارد!</b>' : '❌ <b>No other members to transfer to!</b>',
  deleteRetired: (lang: Language) =>
    lang === 'fa'
      ? '💡 دستور <code>/delete</code> حذف شده است. لطفاً از <code>/transaction</code> برای مشاهده جزئیات و حذف تراکنش‌ها استفاده کنید.'
      : '💡 The <code>/delete</code> command has been retired. Please use <code>/transaction</code> to view and delete transactions.',
  closeMoved: (lang: Language) =>
    lang === 'fa'
      ? '💡 دستور <code>/close</code> به منوی <code>/projects</code> منتقل شد. با انتخاب پروژه در <code>/projects</code> می‌توانید آن را ببندید.'
      : '💡 The <code>/close</code> command has been moved into <code>/projects</code>. Tap an open project in <code>/projects</code> to close it.',
  myBalanceGroupNotice: (lang: Language) =>
    lang === 'fa'
      ? 'لطفاً از /balances در گروه یا در گفتگوی خصوصی با ربات استفاده کنید.'
      : 'Use /balances inside your group, or use private chat.',

  // Start & Help
  startGroup: (lang: Language) =>
    lang === 'fa'
      ? `👋 دُنگ بات فعال است!\n\nایجاد پروژه جدید با: <code>/new &lt;نام&gt; [واحد پول]</code>\nبرای مشاهده راهنما /help را ارسال کنید.`
      : `👋 Dong Bot is active!\n\nCreate a project with: <code>/new &lt;Name&gt; [Currency]</code>\nType /help to see all commands.`,
  startPrivate: (lang: Language) =>
    lang === 'fa'
      ? `👋 <b>به دُنگ بات خوش آمدید!</b>\n\nاینجا در چت خصوصی می‌توانید بدهی‌ها، طلب‌ها و پروژه‌های فعال خود را در تمامی گروه‌ها به راحتی مشاهده کنید.\n\n👇 <b>یک گزینه را انتخاب کنید:</b>`
      : `👋 <b>Welcome to Dong Split Bot!</b>\n\nHere in private chat, you can check your debts, credits, and active projects across all your groups without using slash commands.\n\n👇 <b>Tap a button below:</b>`,
  helpGroup: (lang: Language) =>
    lang === 'fa'
      ? `📖 <b>دستورات دُنگ بات:</b>\n\n` +
        `• <code>/new &lt;نام&gt; [واحد پول]</code> — ایجاد پروژه جدید\n` +
        `• <code>/add [مبلغ] [توضیحات]</code> — ثبت هزینه جدید (پشتیبانی از محاسبات: <code>5000+2000 تاکسی</code>)\n` +
        `• <code>/pay [مبلغ]</code> — ثبت واریزی و بازپرداخت (مانند: <code>10000/2</code>)\n` +
        `• <code>/transaction</code> — مشاهده جزئیات و حذف تراکنش‌ها\n` +
        `• <code>/balances</code> — مشاهده وضعیت حساب و بدهی اعضا\n` +
        `• <code>/settle</code> — محاسبه کمترین تعداد پرداخت برای تسویه کامل\n` +
        `• <code>/projects</code> — گزارش هزینه‌ها، بستن و حذف پروژه‌ها\n` +
        `• <code>/lang</code> — تغییر زبان (English / فارسی)\n` +
        `• <code>/help</code> — راهنمای استفاده از ربات\n`
      : `📖 <b>Dong Split Bot Commands:</b>\n\n` +
        `• <code>/new &lt;Name&gt; [Currency]</code> — Create a new project\n` +
        `• <code>/add [amount] [desc]</code> — Record a new expense (supports math: <code>5000+2000 Taxi</code>)\n` +
        `• <code>/pay [amount]</code> — Record a transfer (supports math: <code>10000/2</code>)\n` +
        `• <code>/transaction</code> — View details and delete transactions\n` +
        `• <code>/balances</code> — View member balances and breakdown\n` +
        `• <code>/settle</code> — Get optimal debt settlement plan\n` +
        `• <code>/projects</code> — View projects, reports, close & delete\n` +
        `• <code>/lang</code> — Change language (English / فارسی)\n` +
        `• <code>/help</code> — How to use Dong Bot\n`,
  helpPrivate: (lang: Language) =>
    lang === 'fa'
      ? `👋 <b>راهنمای دُنگ بات</b>\n\n` +
        `<b>نحوه استفاده در گروه‌ها:</b>\n` +
        `۱. ربات را به گروه خود اضافه کنید.\n` +
        `۲. دستور <code>/new &lt;نام&gt; [واحد پول]</code> را برای ایجاد پروژه بفرستید.\n` +
        `۳. اعضای گروه دکمه <b>عضویت در پروژه</b> را بزنند.\n` +
        `۴. هزینه‌ها را با <code>/add 50000 شام</code> ثبت کنید (پشتیبانی از جمع و ضرب: <code>20000+30000</code>).\n` +
        `۵. وضعیت حساب را هر زمان با <code>/balances</code> یا <code>/settle</code> بررسی کنید.\n` +
        `۶. تراکنش‌ها را با <code>/transaction</code> مشاهده و مدیریت کنید.\n` +
        `۷. بازپرداخت‌ها را با <code>/pay 10000</code> ثبت کنید.\n` +
        `۸. گزارش‌ها، بستن یا حذف پروژه را با <code>/projects</code> انجام دهید.\n\n` +
        `<i>در این چت خصوصی می‌توانید وضعیت حساب خود در تمام گروه‌ها را مشاهده کنید!</i>`
      : `👋 <b>Dong Split Bot Guide</b>\n\n` +
        `<b>How to use in groups:</b>\n` +
        `1. Add me to your group.\n` +
        `2. Type <code>/new &lt;Name&gt; [Currency]</code> to create a project.\n` +
        `3. Group members tap <b>Join Project</b>.\n` +
        `4. Log expenses with <code>/add 5000 Taxi</code> (supports math: <code>2000+3000</code>).\n` +
        `5. Check balances anytime with <code>/balances</code> or <code>/settle</code>.\n` +
        `6. View and manage transactions with <code>/transaction</code>.\n` +
        `7. Record repayments with <code>/pay 1000</code>.\n` +
        `8. View reports and close/delete projects via <code>/projects</code>.\n\n` +
        `<i>In this private chat, you can tap the buttons below anytime to check your balances and projects!</i>`,

  // /new
  newPrivateErr: (lang: Language) =>
    lang === 'fa' ? 'لطفاً از /new داخل گروه استفاده کنید.' : 'Please use /new inside a group chat.',
  newStep1Prompt: (lang: Language, draftId: string) =>
    lang === 'fa'
      ? `به این پیام با <b>نام پروژه</b> پاسخ دهید (مثلاً <code>سفر شمال</code> یا <code>مهمونی</code>):\n\n<span class="tg-spoiler">[Action: new_step1_${draftId}]</span>`
      : `Reply to this message with your <b>Project Name</b> (e.g. <code>Party</code> or <code>Trip to Paris</code>):\n\n<span class="tg-spoiler">[Action: new_step1_${draftId}]</span>`,
  newStep1Placeholder: (lang: Language) =>
    lang === 'fa' ? 'نام پروژه (مثلاً سفر شمال)' : 'Project Name (e.g. Party)',
  tapToCancel: (lang: Language, actionTag: string) =>
    lang === 'fa'
      ? `<i>برای انصراف دکمه زیر را بزنید:</i>\n<span class="tg-spoiler">[Action: ${actionTag}]</span>`
      : `<i>Tap below to cancel:</i>\n<span class="tg-spoiler">[Action: ${actionTag}]</span>`,
  quickActions: (lang: Language, actionTag: string) =>
    lang === 'fa'
      ? `<i>عملیات سریع:</i>\n<span class="tg-spoiler">[Action: ${actionTag}]</span>`
      : `<i>Quick actions:</i>\n<span class="tg-spoiler">[Action: ${actionTag}]</span>`,
  newStep2Prompt: (lang: Language, name: string, draftId: string) =>
    lang === 'fa'
      ? `📁 پروژه: <b>${escapeHtml(name)}</b>\n\nواحد پول را بفرستید (مثلاً <code>تومان</code>، <code>هزار تومان</code>، <code>$</code>) یا <b>رد کردن</b> را بزنید:\n\n<span class="tg-spoiler">[Action: new_step2_${draftId}]</span>`
      : `📁 Project: <b>${escapeHtml(name)}</b>\n\nReply with an optional <b>Currency</b> (e.g. <code>$</code>, <code>€</code>, <code>Toman</code>), or tap <b>Skip</b>:\n\n<span class="tg-spoiler">[Action: new_step2_${draftId}]</span>`,
  newStep2Placeholder: (lang: Language) =>
    lang === 'fa' ? 'واحد پول یا رد کردن' : 'Currency or tap Skip',
  projectCreated: (lang: Language, name: string, currency: string, members: string, actionTag: string) =>
    lang === 'fa'
      ? `🎉 پروژه <b>${escapeHtml(name)}</b>${currency ? ' (' + escapeHtml(currency) + ')' : ''} ایجاد شد!\n\n👥 <b>اعضای فعلی:</b> ${members}\n\nروی <b>عضویت در پروژه</b> بزنید یا با ارسال اسم، دیگران را اضافه کنید:\n\n<span class="tg-spoiler">[Action: ${actionTag}]</span>`
      : `🎉 Project <b>${escapeHtml(name)}</b>${currency ? ' (' + escapeHtml(currency) + ')' : ''} created!\n\n👥 <b>Current Members:</b> ${members}\n\nTap <b>Join Project</b> below or reply with a name to add someone:\n\n<span class="tg-spoiler">[Action: ${actionTag}]</span>`,
  groupLocked: (lang: Language) =>
    lang === 'fa' ? '✅ اعضای پروژه ثبت شدند. اکنون می‌توانید با /add هزینه‌ها را وارد کنید.' : '✅ Group locked. You can now log expenses with /add.',

  // /add
  addPrivateErr: (lang: Language) =>
    lang === 'fa' ? 'لطفاً از /add در گروه استفاده کنید.' : 'Use /add in your group.',
  addStep1Prompt: (lang: Language, draftId: string) =>
    lang === 'fa'
      ? `به این پیام با <b>مبلغ هزینه</b> پاسخ دهید (مثلاً <code>50000</code> یا <code>2000+3000</code>):\n\n<span class="tg-spoiler">[Action: add_step1_${draftId}]</span>`
      : `Reply to this message with the <b>Expense Amount</b> (e.g. <code>50000</code> or <code>2000+3000</code>):\n\n<span class="tg-spoiler">[Action: add_step1_${draftId}]</span>`,
  addStep1OptMsg: (lang: Language, draftId: string) =>
    lang === 'fa'
      ? `<i>مبلغ کل را نمی‌دانید؟ دکمه زیر را بزنید:</i>\n<span class="tg-spoiler">[Action: add_step1_${draftId}]</span>`
      : `<i>Don't know the total amount? Tap below:</i>\n<span class="tg-spoiler">[Action: add_step1_${draftId}]</span>`,
  addStep1Placeholder: (lang: Language) =>
    lang === 'fa' ? 'مبلغ هزینه (مثلاً 50000)' : 'Expense Amount (e.g. 50000)',
  addStep2PromptFixed: (lang: Language, amount: number, draftId: string) =>
    lang === 'fa'
      ? `💰 مبلغ: <b>${amount}</b>\n<b>توضیحات یا بابتِ</b> هزینه را بفرستید (مثلاً <code>شام</code>) یا <b>رد کردن</b> را بزنید:\n\n<span class="tg-spoiler">[Action: add_step2_${draftId}]</span>`
      : `💰 Amount: <b>${amount}</b>\nReply with an optional <b>Description</b> (e.g. <code>Dinner</code>) or tap <b>Skip</b>:\n\n<span class="tg-spoiler">[Action: add_step2_${draftId}]</span>`,
  addStep2PromptUnequal: (lang: Language, draftId: string) =>
    lang === 'fa'
      ? `⚡ <b>هزینه دانگ نامساوی</b>\n<b>توضیحات یا بابتِ</b> هزینه را بفرستید (مثلاً <code>شام</code>) یا <b>رد کردن</b> را بزنید:\n\n<span class="tg-spoiler">[Action: add_step2_${draftId}]</span>`
      : `⚡ <b>Unequal Expense</b>\nReply with an optional <b>Description</b> (e.g. <code>Dinner</code>) or tap <b>Skip</b>:\n\n<span class="tg-spoiler">[Action: add_step2_${draftId}]</span>`,
  addStep2Placeholder: (lang: Language) =>
    lang === 'fa' ? 'توضیحات یا رد کردن' : 'Description or tap Skip',
  promptPayer: (lang: Language, desc: string, amountLabel: string) =>
    lang === 'fa'
      ? `🧾 <b>${escapeHtml(desc)}</b> ${amountLabel}\n👉 <b>چه کسی پرداخت کرده است؟</b>`
      : `🧾 <b>${escapeHtml(desc)}</b> ${amountLabel}\n👉 <b>Who paid?</b>`,
  splitSelectHeaderEqual: (lang: Language, desc: string, amount: number) =>
    lang === 'fa'
      ? `🧾 <b>${escapeHtml(desc)}</b> (${amount})\n<i>مشخص کنید این هزینه بین چه کسانی مساوی تقسیم شود:</i>`
      : `🧾 <b>${escapeHtml(desc)}</b> (${amount})\n<i>Toggle who shares this equally, or choose Unequal:</i>`,
  splitSelectHeaderUnequal: (lang: Language, desc: string) =>
    lang === 'fa'
      ? `🧾 <b>${escapeHtml(desc)}</b> (⚡ دانگ نامساوی)\n<i>افرادی که در این هزینه سهیم هستند را انتخاب کنید:</i>`
      : `🧾 <b>${escapeHtml(desc)}</b> (⚡ Unequal Share)\n<i>Select who shares this expense, then enter individual shares:</i>`,
  promptNextShareMsg: (
    lang: Language,
    desc: string,
    step: number,
    total: number,
    progress: string,
    status: string,
    name: string,
    draftId: string
  ) =>
    lang === 'fa'
      ? `⚡ <b>تقسیم نامساوی:</b> ${escapeHtml(desc)}\nمرحله <b>${step}</b> از <b>${total}</b>\n\n${progress}${status}\n\n<b>سهم ${escapeHtml(name)}</b> را بفرستید (مثلاً <code>2500</code> یا <code>0</code>):\n\n<span class="tg-spoiler">[Action: split_step_${draftId}]</span>`
      : `⚡ <b>Unequal Split:</b> ${escapeHtml(desc)}\nStep <b>${step}</b> of <b>${total}</b>\n\n${progress}${status}\n\nReply with <b>${escapeHtml(name)}&#39;s share</b> (e.g. <code>2500</code> or <code>0</code>):\n\n<span class="tg-spoiler">[Action: split_step_${draftId}]</span>`,
  sharePlaceholder: (lang: Language, name: string) =>
    lang === 'fa' ? `سهم ${name.slice(0, 25)}` : `Share for ${name.slice(0, 25)}`,
  amountExceedsRemaining: (lang: Language, amt: number, rem: number, total: number, draftId: string) =>
    lang === 'fa'
      ? `⚠️ <b>مبلغ از مقدار باقی‌مانده بیشتر است!</b>\n\nوارد شده: <b>${amt}</b> | باقی‌مانده: <b>${rem}</b> (کل: <b>${total}</b>)\n\nلطفاً حداکثر تا <b>${rem}</b> وارد کنید:\n\n<span class="tg-spoiler">[Action: split_step_${draftId}]</span>`
      : `⚠️ <b>Amount exceeds remaining!</b>\n\nEntered: <b>${amt}</b> | Remaining: <b>${rem}</b> (Total: <b>${total}</b>)\n\nPlease reply with up to <b>${rem}</b>:\n\n<span class="tg-spoiler">[Action: split_step_${draftId}]</span>`,
  totalMismatch: (lang: Language, sum: number, total: number, diff: number) =>
    lang === 'fa'
      ? `⚠️ <b>عدم تطابق مبلغ کل</b>\n\nمجموع ورودی‌ها <b>${sum}</b> شد اما مبلغ کل <b>${total}</b> ثبت شده بود (اختلاف: <b>${diff > 0 ? '+' : ''}${diff}</b>).\n\nیک گزینه را انتخاب کنید:`
      : `⚠️ <b>Total Mismatch</b>\n\nInputs sum to <b>${sum}</b>, but total was set to <b>${total}</b> (diff: <b>${diff > 0 ? '+' : ''}${diff}</b>).\n\nChoose an option below:`,
  expenseSavedEqual: (lang: Language, desc: string, amount: number, count: number) =>
    lang === 'fa'
      ? `✅ <b>هزینه ذخیره شد!</b>\n🧾 <b>${escapeHtml(desc)}</b> (${amount})\n\n<i>تقسیم مساوی بین ${count} نفر.</i>`
      : `✅ <b>Expense Saved!</b>\n🧾 <b>${escapeHtml(desc)}</b> (${amount})\n\n<i>Split equally between ${count} members.</i>`,
  expenseSavedUnequalHeader: (lang: Language, desc: string, amount: number) =>
    lang === 'fa'
      ? `✅ <b>هزینه ذخیره شد!</b>\n🧾 <b>${escapeHtml(desc)}</b> (${amount})\n\n`
      : `✅ <b>Expense Saved!</b>\n🧾 <b>${escapeHtml(desc)}</b> (${amount})\n\n`,

  // /pay
  payPrivateErr: (lang: Language) =>
    lang === 'fa' ? 'لطفاً از /pay داخل گروه استفاده کنید.' : 'Use /pay in your group.',
  payStep1Prompt: (lang: Language, draftId: string) =>
    lang === 'fa'
      ? `به این پیام با <b>مبلغ پرداختی</b> پاسخ دهید (مثلاً <code>50000</code> یا <code>10000/2</code>):\n\n<span class="tg-spoiler">[Action: pay_step1_${draftId}]</span>`
      : `Reply with the <b>Payment Amount</b> (e.g. <code>50000</code> or <code>10000/2</code>):\n\n<span class="tg-spoiler">[Action: pay_step1_${draftId}]</span>`,
  payStep1Placeholder: (lang: Language) =>
    lang === 'fa' ? 'مبلغ پرداختی (مثلاً 50000)' : 'Payment Amount (e.g. 50000)',
  promptPaySender: (lang: Language, amount: number) =>
    lang === 'fa'
      ? `💸 <b>انتقال مبلغ ${amount}</b>\n👉 <b>چه کسی واریز کرده؟ (فرستنده)</b>`
      : `💸 <b>Transfer of ${amount}</b>\n👉 <b>Who is paying? (Sender)</b>`,
  promptPayReceiver: (lang: Language, amount: number) =>
    lang === 'fa'
      ? `💸 <b>انتقال مبلغ ${amount}</b>\n👉 <b>به چه کسی واریز شده؟ (گیرنده)</b>`
      : `💸 <b>Transfer of ${amount}</b>\n👉 <b>Who is receiving?</b>`,
  paymentRecorded: (lang: Language, from: string, to: string, amount: number, curr: string) =>
    lang === 'fa'
      ? `\u200E✅ <b>پرداخت ثبت شد!</b>\n\n\u200E💸 <b>${escapeHtml(from)}</b> به <b>${escapeHtml(to)}</b>: <b>${amount}${curr}</b>`
      : `\u200E✅ <b>Payment Recorded!</b>\n\n\u200E💸 <b>${escapeHtml(from)}</b> to <b>${escapeHtml(to)}</b>: <b>${amount}${curr}</b>`,

  // /balances
  balancesMenuTitle: (lang: Language, projName: string) =>
    lang === 'fa'
      ? `📊 <b>وضعیت حساب — ${escapeHtml(projName)}:</b>\nروی هر شخص بزنید تا جزئیات حساب را ببینید:`
      : `📊 <b>Balances for ${escapeHtml(projName)}:</b>\nTap a member below to see their detailed breakdown:`,
  noMembersInProject: (lang: Language, projName: string) =>
    lang === 'fa'
      ? `📊 <b>وضعیت حساب — ${escapeHtml(projName)}:</b>\nهنوز هیچ عضوی در این پروژه وجود ندارد.`
      : `📊 <b>Balances for ${escapeHtml(projName)}:</b>\nNo members in this project yet.`,
  debtsSectionTitle: (lang: Language) =>
    lang === 'fa' ? `🧾 <b>بدهی‌ها و طلب‌ها:</b>\n` : `🧾 <b>Debts & Credits:</b>\n`,
  debtLine: (lang: Language, amt: string, toName: string) =>
    lang === 'fa'
      ? `\u200E🔴 بدهکار است: <b>${amt}</b> به ${escapeHtml(toName)}\n`
      : `\u200E🔴 Owes <b>${amt}</b> to ${escapeHtml(toName)}\n`,
  creditLine: (lang: Language, amt: string, fromName: string) =>
    lang === 'fa'
      ? `\u200E🟢 طلبکار است: <b>${amt}</b> از ${escapeHtml(fromName)}\n`
      : `\u200E🟢 Gets <b>${amt}</b> from ${escapeHtml(fromName)}\n`,
  noPendingDebts: (lang: Language) =>
    lang === 'fa' ? `✅ <b>هیچ بدهی معوقه‌ای وجود ندارد!</b>\n\n` : `✅ <b>No pending debts!</b>\n\n`,
  totalPaidLine: (lang: Language, paid: string) =>
    lang === 'fa' ? `💰 <b>مجموع پرداختی:</b> ${paid}\n` : `💰 <b>Total Paid:</b> ${paid}\n`,
  totalShareLine: (lang: Language, share: string) =>
    lang === 'fa' ? `🍽️ <b>مجموع سهم:</b> ${share}\n` : `🍽️ <b>Total Share:</b> ${share}\n`,
  netGetsBack: (lang: Language, bal: string) =>
    lang === 'fa' ? `\u200E🟢 <b>خالص:</b> طلبکار است <b>+${bal}</b>` : `🟢 <b>Net:</b> Gets back <b>+${bal}</b>`,
  netOwes: (lang: Language, bal: string) =>
    lang === 'fa' ? `\u200E🔴 <b>خالص:</b> بدهکار است <b>${bal}</b>` : `🔴 <b>Net:</b> Owes <b>${bal}</b>`,
  netSettled: (lang: Language) =>
    lang === 'fa' ? `\u200E⚪ <b>خالص:</b> بی‌حساب ($0.00)` : `⚪ <b>Net:</b> Settled ($0.00)`,
  memberNotInvolvedNote: (lang: Language) =>
    lang === 'fa'
      ? `\n\nℹ️ <i>این عضو هنوز در هیچ هزینه یا پرداختی شریک نبوده است.</i>`
      : `\n\nℹ️ <i>This member has not participated in any expenses or transfers yet.</i>`,
  askRemoveMember: (lang: Language, name: string, projName: string) =>
    lang === 'fa'
      ? `⚠️ <b>حذف عضو از پروژه؟</b>\n\nآیا از حذف <b>${escapeHtml(name)}</b> از پروژه <b>${escapeHtml(projName)}</b> اطمینان دارید؟\n\n<i>ℹ️ این عضو در هیچ هزینه یا پرداختی مشارکت نداشته و از لیست پروژه حذف خواهد شد.</i>`
      : `⚠️ <b>Remove Member from Project?</b>\n\nAre you sure you want to remove <b>${escapeHtml(name)}</b> from <b>${escapeHtml(projName)}</b>?\n\n<i>ℹ️ This member has no recorded expenses or payments and will be removed from the project list.</i>`,
  memberRemovedSuccess: (lang: Language, name: string, projName: string) =>
    lang === 'fa'
      ? `✅ <i>عضو <b>${escapeHtml(name)}</b> با موفقیت از پروژه ${escapeHtml(projName)} حذف شد.</i>`
      : `✅ <i>Member <b>${escapeHtml(name)}</b> was successfully removed from ${escapeHtml(projName)}.</i>`,

  // /settle
  settlePlanTitle: (lang: Language, projName: string) =>
    lang === 'fa'
      ? `⚖️ <b>برنامه تسویه حساب — ${escapeHtml(projName)}:</b>\n\n`
      : `⚖️ <b>Settlement Plan — ${escapeHtml(projName)}:</b>\n\n`,
  allSettledUp: (lang: Language) =>
    lang === 'fa' ? `✅ <b>همه بی‌حساب هستند!</b> هیچ بدهی باقی نمانده است.` : `✅ <b>All settled up!</b> Everyone has zero balance.`,
  settleTransferLine: (lang: Language, from: string, to: string, amt: string) =>
    lang === 'fa'
      ? `\u200E💸 <b>${escapeHtml(from)}</b> به <b>${escapeHtml(to)}</b>: <b>${amt}</b>`
      : `\u200E💸 <b>${escapeHtml(from)}</b> to <b>${escapeHtml(to)}</b>: <b>${amt}</b>`,
  settleTip: (lang: Language) =>
    lang === 'fa' ? `\n\n<i>نکته: برای ثبت واریزی‌ها از /pay استفاده کنید.</i>` : `\n\n<i>Tip: Use /pay to record transfers.</i>`,

  // /transaction
  txMenuTitle: (lang: Language, projName: string, page: number, total: number) =>
    lang === 'fa'
      ? `🧾 <b>تراکنش‌ها — ${escapeHtml(projName)}</b> (صفحه ${page}/${total}):\nبرای مشاهده جزئیات یا حذف، روی تراکنش بزنید:`
      : `🧾 <b>Transactions — ${escapeHtml(projName)}</b> (Page ${page}/${total}):\nTap a transaction to view details or delete:`,
  noTransactionsYet: (lang: Language, projName: string) =>
    lang === 'fa'
      ? `🧾 <b>تراکنش‌ها — ${escapeHtml(projName)}:</b>\n\n<i>هنوز هیچ تراکنشی ثبت نشده است.</i>`
      : `🧾 <b>Transactions — ${escapeHtml(projName)}:</b>\n\n<i>No transactions recorded yet.</i>`,
  txExpenseDetails: (lang: Language, desc: string, payer: string, amt: string, date: string) =>
    lang === 'fa'
      ? `🧾 <b>جزئیات هزینه</b>\n\n🏷️ <b>بابت / توضیحات:</b> ${escapeHtml(desc)}\n👤 <b>پرداخت‌کننده:</b> ${escapeHtml(payer)}\n💰 <b>مبلغ کل:</b> ${amt}\n` +
        (date ? `📅 <b>تاریخ:</b> <code>${escapeHtml(date)}</code>\n` : '') +
        `\n👥 <b>سهم اعضا:</b>\n`
      : `🧾 <b>Expense Details</b>\n\n🏷️ <b>Description:</b> ${escapeHtml(desc)}\n👤 <b>Paid by:</b> ${escapeHtml(payer)}\n💰 <b>Full Amount:</b> ${amt}\n` +
        (date ? `📅 <b>Date:</b> <code>${escapeHtml(date)}</code>\n` : '') +
        `\n👥 <b>Member Shares:</b>\n`,
  txPaymentDetails: (lang: Language, sender: string, receiver: string, amt: string, date: string) =>
    lang === 'fa'
      ? `💸 <b>جزئیات پرداخت</b>\n\n\u200E👤 <b>فرستنده:</b> ${escapeHtml(sender)}\n\u200E👉 <b>گیرنده:</b> ${escapeHtml(receiver)}\n💰 <b>مبلغ:</b> ${amt}\n` +
        (date ? `📅 <b>تاریخ:</b> <code>${escapeHtml(date)}</code>\n` : '')
      : `💸 <b>Payment Details</b>\n\n\u200E👤 <b>Sender:</b> ${escapeHtml(sender)}\n\u200E👉 <b>Receiver:</b> ${escapeHtml(receiver)}\n💰 <b>Amount:</b> ${amt}\n` +
        (date ? `📅 <b>Date:</b> <code>${escapeHtml(date)}</code>\n` : ''),
  askDeleteExpense: (lang: Language, desc: string, amt: string) =>
    lang === 'fa'
      ? `⚠️ <b>حذف هزینه؟</b>\n\nآیا از حذف دائمی این هزینه اطمینان دارید؟\n🧾 <b>${escapeHtml(desc)}</b> (${amt})\n\n<i>⚠️ این عملیات غیرقابل بازگشت است و حساب‌ها دوباره محاسبه می‌شوند.</i>`
      : `⚠️ <b>Delete Expense?</b>\n\nAre you sure you want to permanently delete:\n🧾 <b>${escapeHtml(desc)}</b> (${amt})\n\n<i>⚠️ This action cannot be undone. Balances will be recalculated.</i>`,
  askDeletePayment: (lang: Language, sender: string, receiver: string, amt: string) =>
    lang === 'fa'
      ? `⚠️ <b>حذف پرداخت؟</b>\n\nآیا از حذف دائمی این پرداخت اطمینان دارید؟\n\u200E💸 <b>${escapeHtml(sender)}</b> به <b>${escapeHtml(receiver)}</b> (${amt})\n\n<i>⚠️ این عملیات غیرقابل بازگشت است و حساب‌ها دوباره محاسبه می‌شوند.</i>`
      : `⚠️ <b>Delete Payment?</b>\n\nAre you sure you want to permanently delete:\n\u200E💸 <b>${escapeHtml(sender)}</b> to <b>${escapeHtml(receiver)}</b> (${amt})\n\n<i>⚠️ This action cannot be undone. Balances will be recalculated.</i>`,
  expenseDeletedPermanently: (lang: Language) =>
    lang === 'fa' ? '🗑️ <i>هزینه برای همیشه حذف شد.</i>' : '🗑️ <i>Expense deleted permanently.</i>',
  paymentDeletedPermanently: (lang: Language) =>
    lang === 'fa' ? '🗑️ <i>پرداخت برای همیشه حذف شد.</i>' : '🗑️ <i>Payment deleted permanently.</i>',

  // /projects & report
  projectsMenuTitle: (lang: Language) =>
    lang === 'fa'
      ? `📜 <b>پروژه‌ها و گزارش‌ها:</b>\nیک پروژه را جهت مشاهده گزارش، بستن یا حذف انتخاب کنید:`
      : `📜 <b>Projects & Reports:</b>\nSelect any project to view its report, close, or delete it:`,
  noProjectsFound: (lang: Language) =>
    lang === 'fa' ? '❌ هیچ پروژه‌ای برای این گروه یافت نشد.' : '❌ No projects found for this group.',
  reportHeader: (lang: Language, projName: string, status: string, total: string, count: number) =>
    lang === 'fa'
      ? `📈 <b>گزارش — ${escapeHtml(projName)}</b> (${status === 'ACTIVE' ? 'فعال' : 'بایگانی‌شده'})\n\n💵 <b>مجموع هزینه‌ها:</b> ${total} (${count} مورد)\n\n👥 <b>خلاصه اعضا:</b>\n`
      : `📈 <b>Report — ${escapeHtml(projName)}</b> (${status})\n\n💵 <b>Total Expenses:</b> ${total} (${count} entries)\n\n👥 <b>Member Summary:</b>\n`,
  reportMemberLine: (lang: Language, name: string, paid: string, bal: string) =>
    lang === 'fa'
      ? `\u200E• <b>${escapeHtml(name)}:</b> پرداختی: ${paid} | خالص: ${bal}\n`
      : `\u200E• <b>${escapeHtml(name)}:</b> Paid ${paid} | Net: ${bal}\n`,
  askCloseUnsettled: (lang: Language, projName: string) =>
    lang === 'fa'
      ? `⚠️ <b>بستن پروژه با بدهی‌های تسویه‌نشده؟</b>\n\nپروژه <b>${escapeHtml(projName)}</b> هنوز بدهی‌های تسویه‌نشده دارد!\n\nآیا مطمئن هستید که می‌خواهید آن را ببندید و بایگانی کنید؟\n\n<i>ℹ️ همواره می‌توانید از طریق /projects گزارش آن را ببینید یا حذفش کنید.</i>`
      : `⚠️ <b>Close Project with Unsettled Debts?</b>\n\nProject <b>${escapeHtml(projName)}</b> still has pending debts!\n\nAre you sure you want to close and archive it?\n\n<i>ℹ️ You can still view its report or delete it anytime from /projects.</i>`,
  projectClosedSuccess: (lang: Language, projName: string) =>
    lang === 'fa'
      ? `🔒 <b>پروژه ${escapeHtml(projName)} با موفقیت بسته و بایگانی شد.</b>`
      : `🔒 <b>Project ${escapeHtml(projName)} is now closed and archived.</b>`,
  askDeleteProject: (lang: Language, projName: string) =>
    lang === 'fa'
      ? `⚠️ <b>حذف کامل پروژه؟</b>\n\nآیا از حذف کامل و همیشگی پروژه <b>${escapeHtml(projName)}</b> اطمینان دارید؟\n\n<i>⚠️ تمام تاریخچه، هزینه‌ها و پرداخت‌های این پروژه برای همیشه پاک خواهد شد و قابل بازگردانی نیست!</i>`
      : `⚠️ <b>Delete Project?</b>\n\nAre you sure you want to permanently delete project <b>${escapeHtml(projName)}</b>?\n\n<i>⚠️ This will permanently erase the project and all its history, expenses, and payments. This action cannot be undone!</i>`,
  projectDeletedSuccess: (lang: Language, projName: string) =>
    lang === 'fa'
      ? `🗑️ <i>پروژه <b>${escapeHtml(projName)}</b> برای همیشه حذف شد.</i>`
      : `🗑️ <i>Project <b>${escapeHtml(projName)}</b> has been permanently deleted.</i>`,

  // Private Chat (PV) screens
  pvNotPartOfAnyActive: (lang: Language) =>
    lang === 'fa' ? 'شما هنوز در هیچ پروژه فعالی عضو نیستید.' : 'You are not part of any active projects yet.',
  pvBalancesTitle: (lang: Language) =>
    lang === 'fa' ? '👤 <b>وضعیت حساب شما در تمام پروژه‌ها:</b>\n\n' : '👤 <b>Your Balances Across All Projects:</b>\n\n',
  pvTapProjectBelow: (lang: Language) =>
    lang === 'fa'
      ? '\n<i>برای مشاهده جزئیات طلب و بدهی، روی پروژه بزنید:</i>'
      : '\n<i>Tap a project below to see who owes whom:</i>',
  pvBreakdownBtn: (lang: Language, name: string) =>
    lang === 'fa' ? `📊 جزئیات: ${name}` : `📊 Breakdown: ${name}`,
  pvNotJoinedAnyProjects: (lang: Language) =>
    lang === 'fa' ? 'شما هنوز به هیچ پروژه‌ای ملحق نشده‌اید.' : 'You have not joined any projects yet.',
  pvProjectsTitle: (lang: Language) =>
    lang === 'fa' ? '📁 <b>پروژه‌های شما:</b>\n\n' : '📁 <b>Your Projects:</b>\n\n',
  pvMembersCount: (lang: Language, count: number) =>
    lang === 'fa' ? `   👥 اعضا: ${count}` : `   👥 Members: ${count}`,
  pvStatusLabel: (lang: Language, status: string) =>
    lang === 'fa' ? (status === 'active' ? 'فعال' : 'بایگانی‌شده') : status.toUpperCase(),
  pvDetailsBtn: (lang: Language, name: string) =>
    lang === 'fa' ? `🔍 جزئیات: ${name}` : `🔍 Details: ${name}`,
  pvSelectProjectTx: (lang: Language) =>
    lang === 'fa'
      ? '📁 <b>یک پروژه را برای مشاهده تراکنش‌های آن انتخاب کنید:</b>\n'
      : '📁 <b>Select a project to view its transactions:</b>\n',
  pvDebtsInProject: (lang: Language) =>
    lang === 'fa' ? '🧾 <b>بدهی‌ها و طلب‌ها در این پروژه:</b>\n' : '🧾 <b>Debts in this project:</b>\n',
  pvYouOwe: (lang: Language, amt: string, toName: string) =>
    lang === 'fa'
      ? `\u200E🔴 شما بدهکارید: <b>${amt}</b> به ${escapeHtml(toName)}\n`
      : `\u200E🔴 You owe <b>${amt}</b> to ${escapeHtml(toName)}\n`,
  pvYouGet: (lang: Language, amt: string, fromName: string) =>
    lang === 'fa'
      ? `\u200E🟢 شما طلبکارید: <b>${amt}</b> از ${escapeHtml(fromName)}\n`
      : `\u200E🟢 You get <b>${amt}</b> from ${escapeHtml(fromName)}\n`,
  pvNoPendingDebtsProj: (lang: Language) =>
    lang === 'fa'
      ? '✅ <b>هیچ بدهی معوقه‌ای در این پروژه وجود ندارد!</b>\n\n'
      : '✅ <b>No pending debts in this project!</b>\n\n',
  pvTotalPaid: (lang: Language, paid: string) =>
    lang === 'fa' ? `💰 <b>مجموع پرداختی:</b> ${paid}\n` : `💰 <b>Total Paid:</b> ${paid}\n`,
  pvYourShare: (lang: Language, share: string) =>
    lang === 'fa' ? `🍽️ <b>سهم شما:</b> ${share}\n` : `🍽️ <b>Your Share:</b> ${share}\n`,
  pvNetTotalGetsBack: (lang: Language, bal: string) =>
    lang === 'fa' ? `\u200E🟢 <b>خالص:</b> طلبکار هستید <b>+${bal}</b>` : `🟢 <b>Net Total:</b> Gets back <b>+${bal}</b>`,
  pvNetTotalOwes: (lang: Language, bal: string) =>
    lang === 'fa' ? `\u200E🔴 <b>خالص:</b> بدهکار هستید <b>${bal}</b>` : `🔴 <b>Net Total:</b> Owes <b>${bal}</b>`,
  pvNetTotalSettled: (lang: Language) =>
    lang === 'fa' ? `\u200E⚪ <b>خالص:</b> بی‌حساب ($0.00)` : `⚪ <b>Net Total:</b> Settled ($0.00)`,
  pvBackBalBtn: (lang: Language) => (lang === 'fa' ? '« حساب من' : '« My Balances'),
  pvBackProjBtn: (lang: Language) => (lang === 'fa' ? '« پروژه‌های من' : '« My Projects'),
};
