# האתר של ד"ר עפר מרבך

Astro 7 במצב שרת על **Cloudflare Workers**, עם GSAP + ScrollTrigger ו-Lenis. עברית RTL.

**הכל בחשבון Cloudflare אחד, בלי שירות חיצוני:**
- **D1:** התוכן, המשתמשים, ה-sessions ומטמון ה-HTML.
- **R2:** התמונות.
- **ממשק ניהול משלנו ב-‎`/admin`:** שם משתמש וסיסמה.

**מסמכים:**
- מדריך לעפר: `docs/מדריך-ניהול-האתר.md`.
- פריסה, צעד אחר צעד (לסול): `docs/deploy-cloudflare.md`.

פרויקט ברטר חיצוני: בלי לוגו של צליל ובלי אזכור של בית הספר. **noindex** עד אישור (בניהול: פרטי קשר והגדרות ← noindex).

## איך זה עובד
- **התוכן:**
  - **טבלאות:** הטבלה `singletons` מחזיקה את תשעת העמודים, `settings` ו-`layout`. הטבלה `entries` מחזיקה את `articles`, `talks`, `videos` ו-`testimonials`. כל שורה היא JSON.
  - **סכמה:** הצורה של כל מסמך מוגדרת ב-`site/src/lib/schema.ts` (zod).
  - **שמירה:** כל שמירה מהניהול עוברת אימות מול הסכמה בשרת.
  - **רינדור:** כל רינדור מפרסר את התוכן דרך אותה סכמה, עם אותן ברירות מחדל.
- **התבניות:** בלי שינוי, חוץ ממקור הנתונים. כל עמוד ורכיב מקבל את הנתונים דרך `useData(Astro.locals)` (‏`site/src/lib/data.ts`).
  - **הבדיקה:** הטקסט ה-HTML של כל עמוד זהה ל-build הסטטי של `main`, וצילומי המסך ב-390 וב-1440 זהים בפיקסלים.
  - **סקריפטים וסגנונות:** כל האנימציות, ה-parallax וסצנת הפעמון לא השתנו: `html.js`, ה-blur על `::before`, `data-lenis-prevent`, `scene-pinned`.
- **מהירות** (`site/src/middleware.ts`):
  - **מטמון:** כל עמוד ציבורי נשמר מרונדר בטבלת `html_cache`, לפי גרסת התוכן ו-id של ה-build. הגשה מהמטמון עולה שאילתת D1 אחת.
  - **ריקון:** כל שמירה מעלה את הגרסה ומרוקנת את המטמון, כך שהשינוי מופיע מיד.
  - **דפדפנים:** מאמתים מחדש עם ETag, והתשובה היא 304.
- **תמונות:**
  - **הגשה:** `/m/<id>-<w>.webp` מוגשות מ-R2 עם `immutable` לשנה, וגם מה-edge cache של Cloudflare כשיש דומיין משלנו.
  - **העלאה:** הדפדפן ממיר כל העלאה ל-WebP ברוחבים 360, 720, 1200 ו-1800. ספארי, שלא יודע לכתוב WebP, מקבל JPEG. הקובץ המקורי נשמר ב-`media/<path>`.
  - **מחיקה:** אי אפשר למחוק תמונה שנמצאת בשימוש.
- **אבטחה** (`site/src/lib/auth.ts`):
  - **סיסמאות:** PBKDF2-SHA256 דרך WebCrypto.
  - **עוגיה:** `__Host-` מסוג HttpOnly, Secure ו-SameSite=Lax.
  - **CSRF:** טוקן לכל session, יחד עם בדיקת Origin.
  - **הגבלת כניסות:** 5 כישלונות לשם משתמש ו-10 לכתובת IP ברבע שעה.
  - **ניהול:** כל `/admin` ו-`/api/admin` דורשים session. בניהול יש CSP קשיח, `X-Robots-Tag: noindex` ו-`no-store`.
  - **HTML במאמרים:** מנוקה בשמירה וגם ברינדור (`site/src/lib/sanitize.ts`).
- **טופס "כתבו המלצה":**
  - **שליחה:** נשאר וואטסאפ או mailto לעפר. ההמלצה נשמרת גם ב-`submissions` כ"ממתינה לאישור".
  - **הגנה מספאם:** honeypot, זמן מינימלי בדף, 5 לשעה לכל IP, 100 ביום לכל האתר, ו-Origin.
- **הטפסים בניהול:**
  - **מקור:** הטפסים נבנים מ-`site/src/admin/formspec.json`, עם התוויות וההסברים בעברית. הקובץ נוצר מ-`.pages.yml` בעזרת `npm run formspec`.
  - **עורך טקסט עשיר:** TipTap, ארוז מקומית.
  - **גרירה:** SortableJS.

## פקודות (מתוך `site/`)
```bash
npm install
npm run db:migrate:local && node scripts/seed.mjs --local      # מסד ו-R2 מקומיים (.wrangler/state)
node scripts/create-user.mjs --local --username yossi --role admin   # מדפיס סיסמה פעם אחת
npm run preview      # astro build + wrangler dev → http://localhost:8787  (/admin)
npm run dev          # שרת הפיתוח של Astro (גם הוא ב-workerd, אותו D1/R2 מקומי)
npm run deploy       # astro build && wrangler deploy   (רק אחרי ההגדרה ב-docs/deploy-cloudflare.md)
npm run images       # media/ → media-cache/m (WebP) + media-cache/images.json: רק בשביל ה-seed
```
`src/content/*` הם **מקור ה-seed בלבד**. אחרי ה-seed, התוכן החי נמצא ב-D1, ועורכים אותו ב-`/admin`.

## מבנה
- **עמודים:**
  - בית; הרצאות וסדנאות, עם 3 מסלולים: צוותים, הורים ומנהלים; קולות פעמונים: ספר, קורס ומועדון.
  - וידאו ותקשורת; מאמרים ומחשבות, עם עמוד לכל מאמר; אודות.
  - יצירת קשר (mailto), כתבו המלצה, נגישות, 404.
- **ניהול:**
  - `src/pages/admin/*`: המסכים.
  - `src/pages/api/admin/*`: ה-API.
  - `src/admin/*`: הקוד בדפדפן ו-CSS.
  - `src/layouts/Admin.astro`.
- **מקורות:**
  - `facts.md`: כל עובדה, עם קישור.
  - `content_inventory.md`: מה נאסף ומאיפה.
  - `scrape/`: החומר הגולמי.
