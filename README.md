<div align="center">

# 🍕 Dong Bot (دُنگ بات)
### The Easiest, Coolest Way to Split Bills with Friends on Telegram!

<p align="center">
  <b>No spreadsheets. No calculators. No awkward "who owes whom" math.</b><br/>
  You don't even need to configure anything or start it — just add it to your group and watch the miracle happen! ✨
</p>

<br/>

<a href="https://t.me/DongShareBot?startgroup=true"><img src="https://img.shields.io/badge/✨_Add_to_Telegram_Group_&_See_Its_Miracle-Free_Forever-2ecc71?style=for-the-badge&logo=telegram&logoColor=white" alt="Add to Telegram Group & See Its Miracle" height="54" /></a>
<br/><br/>
<a href="https://t.me/DongShareBot"><img src="https://img.shields.io/badge/💬_Or_Test_It_in_Private_Chat-@DongShareBot-0088cc?style=for-the-badge&logo=telegram&logoColor=white" alt="Test It in Private Chat" height="38" /></a>

<br/><br/>

[![Telegram](https://img.shields.io/badge/Telegram-@DongShareBot-2CA5E0?style=flat-square&logo=telegram&logoColor=white)](https://t.me/DongShareBot)
[![Free](https://img.shields.io/badge/100%25-Free_%26_Instant-success?style=flat-square)](https://t.me/DongShareBot)
[![Bilingual: English & Persian](https://img.shields.io/badge/Language-English_%26_فارسی-informational?style=flat-square)](https://t.me/DongShareBot)
[![Zero Setup](https://img.shields.io/badge/Setup-Zero_Install-blueviolet?style=flat-square)](https://t.me/DongShareBot?startgroup=true)
[![Cloudflare Workers](https://img.shields.io/badge/Powered_by-Cloudflare_Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License: AGPL v3](https://img.shields.io/badge/License-GNU_AGPLv3-blue.svg?style=flat-square)](LICENSE)

</div>

---

## 🪄 Just Add It to Your Group — That's Literally It!

You don't need to start the bot, configure profiles, or learn complicated commands.

```
       [ 🚗 Road Trip / 🍕 Dinner with Friends ]
                          │
                          ▼
            Just add @DongShareBot to group!
                          │
            Type: /new Trip to North
            (Friends tap [✋ Join Project])
                          │
                          ▼
        Someone buys snacks? /add 85000 Snacks
        Someone pays taxi?   /add 20000+15000 Taxi
                          │
                          ▼
             Trip is over? Type: /settle
                          │
                          ▼
      💥 BOOM! It calculates who pays whom
       with the minimum number of payments!
```

---

## ⚡ Superpowers That Make Life Easy

### 🧮 1. Does Your Math on the Fly
Forgot your calculator? Don't worry about it:
- Type `/add 45000+12000 Taxi` (it sums them up natively!)
- Type `/add 150000/3 Lunch` (evaluates arithmetic on the spot)
- Type `/pay 50000*0.5` when repaying half!

### 🍕 2. Equal or Unequal Split? Both are effortless!
- **Equal Split**: 1 tap to select who shared it, and everyone's share is divided automatically.
- **Unequal Split (دُنگ نامساوی)**: Had 4 people at dinner where one ordered salad and another ordered steak? Tap **⚡ Unequal Share** to enter exact shares step-by-step. Don't know the total bill? It sums up individual shares for you!

### ⚖️ 3. The "Smart Settlement" Magic
Imagine:
- Ali owes Reza $20.
- Reza owes Sara $20.
Instead of doing 2 separate bank transfers, **Dong Bot solves the equation**: Ali pays Sara $20 directly! Everyone is settled with the absolute fewest transactions possible.

### 🌐 4. Full Bilingual Support (English & فارسی) + RTL-Proof
Dong Bot fully supports both **English** and **فارسی (Persian)**:
- Switch language anytime in any chat by sending `/lang`.
- Interactive flag buttons (`🇬🇧 English` / `🇮🇷 فارسی`) let your group choose their preferred language with one tap.
- Persian/Arabic names, currency symbols, and directional transfers (`Ali به Reza` / `Ali to Reza`) never get inverted or reversed in Telegram thanks to strict BiDi/LRM formatting.

### 🧹 5. Keeps Your Group Chat Super Clean
Nobody likes bots that spam 50 messages. Dong Bot automatically cleans up its own prompt questions and temporary buttons once you confirm or finish an action!

### 📱 6. Your Personal Secret Dashboard
Open [@DongShareBot](https://t.me/DongShareBot) in private chat to see:
- 👤 All your debts and credits across **all your different groups** in one screen.
- 📁 Active and past projects.
- 🧾 Past transactions list.
- ⌨️ Custom instant-reply keyboard available in both English and Persian (`👤 My Balances` / `👤 حساب من`).

---

## 🎮 Cheat Sheet: Commands You Can Use

| Want to do this? | Type this | Example |
|:---|:---|:---|
| 🆕 Start a trip or hangout | `/new <Name> [Currency]` | `/new Trip to North $` |
| 💸 Log an expense (supports math!) | `/add <Amount> <Item>` | `/add 50000+15000 Dinner` |
| 💳 Record a repayment transfer | `/pay <Amount>` | `/pay 25000` |
| ⚖️ See who owes whom (smart plan) | `/settle` | `/settle` |
| 📊 Check everyone's balances & stats | `/balances` | `/balances` |
| 🧾 Browse & inspect transactions | `/transaction` | `/transaction` |
| 📈 View full reports / close project | `/projects` | `/projects` |
| 🌐 Change language (English / فارسی) | `/lang` | `/lang` |
| ❓ Quick guide & help | `/help` | `/help` |

---

<div align="center">

## 🚀 Ready to Experience the Miracle?

Add it to your group in 5 seconds — you'll never split expenses manually again!

<br/>

<a href="https://t.me/DongShareBot?startgroup=true"><img src="https://img.shields.io/badge/✨_Add_to_Telegram_Group_Now-Free_Forever-2ecc71?style=for-the-badge&logo=telegram&logoColor=white" height="54" /></a>
<br/><br/>
<a href="https://t.me/DongShareBot"><img src="https://img.shields.io/badge/💬_Or_Test_It_in_Private_Chat-@DongShareBot-0088cc?style=for-the-badge&logo=telegram&logoColor=white" height="38" /></a>

<br/><br/>

</div>

---

<details>
<summary><b>🛠️ For Developers & Self-Hosters (Click to expand)</b></summary>

<br/>

### Tech Stack
- **Edge Runtime**: [Cloudflare Workers](https://workers.cloudflare.com/) (Ultra-fast serverless edge compute)
- **Bot Framework**: [grammY](https://grammy.dev/)
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/) (Serverless SQLite)
- **CI/CD**: GitHub Actions

### Quick Self-Hosting Steps
1. Clone repo: `git clone https://github.com/mohasara/Dong-Telegram-Bot.git`
2. Install dependencies: `npm install`
3. Create D1 database: `npx wrangler d1 create dong_db`
4. Run schema migration: `npx wrangler d1 execute dong_db --remote --file=./schema.sql`
5. Set bot token: `npx wrangler secret put BOT_TOKEN`
6. Deploy: `npm run deploy`
7. Set webhook: `curl -F "url=https://<worker-domain>.workers.dev" https://api.telegram.org/bot<TOKEN>/setWebhook`
8. Sync commands: `curl https://<worker-domain>.workers.dev/setcommands`

</details>

---

## 📄 License

This project is licensed under the **GNU Affero General Public License v3.0 (GNU AGPLv3)** — see the [LICENSE](LICENSE) file for full details.

<br/>

<div align="center">
  <sub>Made with ❤️ for fun, easy group hangouts.</sub>
</div>
