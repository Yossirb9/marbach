# האתר של ד"ר עפר מרבך

Astro 7, GSAP + ScrollTrigger, Lenis. עברית RTL. התוכן ב-`site/src/content` (JSON), הניהול ב-Pages CMS (`.pages.yml`).
**כל טקסט באתר נמצא בקובצי התוכן, לא בתבניות**: `pages/<עמוד>.json` (סכמה נפרדת לכל עמוד ב-`content.config.ts`), `layout.json` (תפריט, ראש העמוד, תחתית, הפס הכהה, 404), `settings.json` (פרטי קשר וקישורים), והאוספים `articles`, `testimonials`, `videos`, `talks`. מדריך לעפר: `docs/מדריך-ניהול-האתר.md`.
**פריסה**: push ל-`main` (כולל כל שמירה ב-Pages CMS) → `.github/workflows/deploy.yml` בונה ומפרסם ל-GitHub Pages תוך כ-2 דקות. `public/m` + `src/data/images.json` הם מטמון שנשמר בגיט, כדי שהבנייה תמיר רק תמונות חדשות.
פרויקט ברטר חיצוני: בלי לוגו של צליל ובלי אזכור של בית הספר. **noindex** עד אישור (`settings.json` → `noindex`).

## פקודות (מתוך `site/`)
```bash
npm install
npm run build                    # build-images (media → WebP) + astro build → dist/
node scripts/qa-shots.mjs        # צילומי 390/1440 לכל עמוד → ../qa/shots + תמונות שבורות, גלילה אופקית, קונסול, קישורים
MOTION=1 node scripts/qa-shots.mjs   # אותן בדיקות עם האנימציות פעילות → ../qa/shots-motion
node scripts/qa-scroll.mjs       # סצנת הפעמון: פריימים 0–100% ב-390, 412x640, 1440 → ../qa/scroll + בדיקות + תפריט נייד
npm run assets                   # חד-פעמי: איורים מ-assets-src/generated → media/art (רקע הנייר הופך לשקוף), צילומים, כריכה
```
**GitHub Pages בתת-תיקייה** (ב-Git Bash חובה `MSYS_NO_PATHCONV=1`):
```bash
MSYS_NO_PATHCONV=1 BASE_PATH=/marbach/ SITE_URL=https://yossirb9.github.io npm run build
```
כל כתובת פנימית עוברת דרך `withBase()` ב-`src/lib/data.ts`.

## מבנה
- עמודים: בית, הרצאות וסדנאות (3 מסלולים: צוותים / הורים / מנהלים), קולות פעמונים (ספר, קורס, מועדון), וידאו ותקשורת, מאמרים ומחשבות (+ עמוד לכל מאמר), אודות, יצירת קשר (mailto), כתבו המלצה (וואטסאפ / mailto לעפר, בלי שרת), נגישות, 404.
- המלצות (`testimonials`): ציטוטים → דף הבית, הרצאות, קולות פעמונים; סרטונים → עמוד הווידאו (ושלושה בדף הבית). `hidden` מסתיר. מאמר עם `draft` לא נבנה.
- סצנת החתימה: `components/BellScene.astro` + `scripts/bell.ts`. מצב הסיום ב-CSS, מצב ההתחלה תחת `html.js` (נקבע ב-`<head>` לפני הציור הראשון).
- לקחים משחר: ה-blur של ה-header על `::before`; ה-nav בנייד עם `data-lenis-prevent` וגובה `calc(100dvh - header)`; נבדק ב-412x640.
- מקורות: `facts.md` (כל עובדה + קישור), `content_inventory.md` (מה נאסף ומאיפה), החומר הגולמי ב-`scrape/`.
