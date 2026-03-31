# دليل نشر لعبة مافيا — خطوة بخطوة

## المتطلبات
- حساب على [Supabase](https://supabase.com) (مجاني)
- حساب على [Vercel](https://vercel.com) (مجاني)
- [Git](https://git-scm.com) مثبت على جهازك

---

## الخطوة 1: إعداد Supabase

### 1.1 إنشاء مشروع جديد
1. اذهب إلى [supabase.com](https://supabase.com) وسجّل دخولك
2. اضغط **New Project**
3. اختر اسماً للمشروع (مثلاً: `mafia-game`)
4. اختر كلمة مرور قوية لقاعدة البيانات
5. اختر المنطقة الأقرب (Europe أو US)
6. انتظر دقيقة حتى ينشأ المشروع

### 1.2 تشغيل Schema قاعدة البيانات
1. في Supabase Dashboard، اذهب إلى **SQL Editor**
2. اضغط **New Query**
3. افتح ملف `supabase/schema.sql` من مجلد اللعبة
4. انسخ المحتوى كاملاً والصقه في المحرر
5. اضغط **Run** (أو Ctrl+Enter)
6. يجب أن ترى: `Success. No rows returned`

### 1.3 الحصول على مفاتيح الـ API
1. اذهب إلى **Project Settings** > **API**
2. انسخ قيمتين:
   - **Project URL** (يبدأ بـ `https://`)
   - **anon public** key (مفتاح طويل)

### 1.4 نشر Edge Functions
في Terminal:
```bash
# تثبيت Supabase CLI
npm install -g supabase

# تسجيل الدخول
supabase login

# ربط المشروع (استبدل YOUR_PROJECT_ID بمعرف مشروعك)
cd C:\Users\M4SHi\Desktop\GAME
supabase link --project-ref YOUR_PROJECT_ID

# نشر الـ Functions
supabase functions deploy start-game
supabase functions deploy night-resolve
supabase functions deploy vote-resolve
```

---

## الخطوة 2: تحديث مفاتيح Supabase في الكود

افتح كل ملف وابحث عن هذا السطرين واستبدلهما:

```javascript
const SUPABASE_URL  = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON = 'YOUR_ANON_KEY';
```

### الملفات التي تحتاج تعديل:
| الملف | الموقع |
|-------|--------|
| `index.html` | قسم `SUPABASE AUTH` |
| `lobby.html` | قسم `SUPABASE SETUP` |
| `join.html` | قسم `Supabase setup` |
| `game.html` | قسم `SUPABASE SETUP` |

### مثال بعد التعديل:
```javascript
const SUPABASE_URL  = 'https://abcdefghijkl.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

---

## الخطوة 3: رفع المشروع على GitHub

```bash
cd C:\Users\M4SHi\Desktop\GAME

# تهيئة Git
git init
git add .
git commit -m "Initial commit: Mafia game"

# إنشاء repo على GitHub ثم:
git remote add origin https://github.com/YOUR_USERNAME/mafia-game.git
git push -u origin main
```

---

## الخطوة 4: النشر على Vercel

### الطريقة السهلة (بدون Terminal):
1. اذهب إلى [vercel.com](https://vercel.com)
2. اضغط **Add New Project**
3. اختر **Import Git Repository**
4. اختر الـ repo الذي أنشأته
5. اضغط **Deploy**
6. انتظر دقيقة — ستحصل على رابط مثل:
   `https://mafia-game-xxx.vercel.app`

### الطريقة السريعة (Terminal):
```bash
npm install -g vercel
vercel
# اتبع التعليمات
```

---

## الخطوة 5: إعداد Auth في Supabase

1. اذهب إلى **Authentication** > **URL Configuration**
2. في **Site URL** ضع رابط Vercel الخاص بك:
   `https://mafia-game-xxx.vercel.app`
3. في **Redirect URLs** أضف:
   `https://mafia-game-xxx.vercel.app/**`
4. اضغط **Save**

---

## الخطوة 6: الاختبار

1. افتح الرابط: `https://mafia-game-xxx.vercel.app`
2. أنشئ حساباً جديداً
3. افتح نافذة متصفح خاصة (Incognito) وأنشئ حساباً آخر
4. من الحساب الأول: أنشئ غرفة
5. من الحساب الثاني: ادخل نفس رمز الغرفة
6. من الحساب الأول (المضيف): ابدأ اللعبة

---

## هيكل الملفات النهائي

```
GAME/
├── index.html          ← الصفحة الرئيسية + تسجيل الدخول
├── lobby.html          ← غرفة الانتظار
├── game.html           ← اللعبة الفعلية
├── join.html           ← الدخول برمز الغرفة
├── store.html          ← المتجر
├── collection.html     ← المجموعة
├── rules.html          ← القوانين
├── vercel.json         ← إعدادات النشر
├── js/
│   └── supabase-client.js
└── supabase/
    ├── schema.sql      ← قاعدة البيانات
    └── functions/
        ├── start-game/index.ts   ← توزيع الأدوار
        ├── night-resolve/index.ts ← حل الليل
        └── vote-resolve/index.ts  ← حل التصويت
```

---

## حل المشاكل الشائعة

| المشكلة | الحل |
|---------|------|
| `Invalid login credentials` | تحقق من البريد وكلمة المرور |
| `relation does not exist` | أعد تشغيل الـ schema.sql |
| اللاعبون لا يظهرون في اللوبي | تحقق من تفعيل Realtime في Supabase |
| Edge Function تعطي 401 | تحقق من JWT token في الـ headers |
| الموقع لا يفتح | تحقق من Vercel deployment logs |

---

## الميزات المدفوعة (مستقبلاً)
- رسائل Push Notifications → Supabase + OneSignal
- حفظ الإحصائيات المتقدمة → Supabase Analytics
- نظام المباريات الرسمية → Supabase Edge Functions + Cron
- تطبيق موبايل → React Native + Expo

---

**بُني بـ:** Supabase + Vercel + GSAP + Web Audio API
