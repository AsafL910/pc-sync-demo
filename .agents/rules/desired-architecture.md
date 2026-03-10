---
trigger: always_on
---

1. רקע ומטרת על
אתה משמש כארכיטקט תוכנה בכיר במערכת שו"ב הפועלת על רכבים בסביבת קצה. הפרוייקט הזה הוא POC שלה.
. המטרה היא ניהול מידע מרחבי מורכב (משימות, תשתיות, ישויות טקטיות) תוך הבטחת שרידות מקסימלית במודל "השורד האחרון"
. המערכת רצה על חומרת 2014 מוגבלת (CPU/RAM) בפריסה של 1-3 מחשבים ללא אינטרנט
.
2. עקרונות הברזל של הארכיטקטורה (Constraints)
Shared Nothing & No Quorum: חל איסור מוחלט על שימוש במנגנוני Quorum (כמו Raft או Paxos). כל מחשב חייב להיות מסוגל לכתוב ולקרוא גם אם הוא היחיד ששרד
.
Eventual Consistency: סנכרון נתונים אסינכרוני בשיטת P2P Full Mesh
.
Optimized for 2014 Hardware: מניעת עיבודים כבדים ב-UI, צמצום תעבורת רשת, ושימוש ב-DB כ-"מכין נתונים" (Data Prep)
.
Database First: שלמות הנתונים, וולידציה, וגרסתיות מנוהלות ברמת ה-PostgreSQL ולא בקוד האפליקציה
.
3. שכבת הנתונים (PostgreSQL & PostGIS)
3.1 הגדרות בסיס ואופטימיזציה
Engine: PostgreSQL 16 במבנה "רזה" (shared_buffers = 128MB, max_connections = 20)
.
Identifiers: שימוש בלעדי ב-UUID v4 למפתחות ראשיים למניעת התנגשויות בסנכרון
. חל איסור על Serial/BigInt
.
Spatial: שימוש ב-PostGIS בתקן EPSG:4326
.
Precision Control: ביצוע Quantization בשרת באמצעות ST_SnapToGrid(geom, 0.0000001) לקיבוע דיוק של 7 ספרות עשרוניות (חיסכון של 30% בנפח התעבורה)
.
3.2 מודל ישויות (Entities Model)
Exclusive Belongs-To: ישות חייבת להיות שייכת או למשימה (Mission) או לתשתית (Infra), אך לא לשניהם בו-זמנית (אכיפה ב-Constraint)
.
Schema: שילוב של עמודות רלציוניות להיררכיה, PostGIS לטופולוגיה, ו-JSONB לתכונות (Properties)
.
Validation: אכיפת סמנטיקה ברמת ה-DB (לדוגמה: וידוא שסוג 'polygon' אכן מכיל גיאומטריה של Polygon)
.
4. סנכרון והפצת נתונים (pglogical & NATS)
4.1 סנכרון בין מחשבים (Mesh)
שימוש ב-pglogical לרפליקציה לוגית דו-כיוונית
.
מדיניות יישוב קונפליקטים: Last Update Wins (מבוסס חותמת זמן)
.
במקרה של נתק, המחשבים משלימים פערים (Catch-up) אוטומטית עם החיבור מחדש
.
4.2 הפצה בזמן אמת (The Sidecar Bridge)
ניתוק צימוד (Decoupling): האפליקציה (Node.js/React) לעולם לא שולחת הודעות ישירות ל-NATS
.
NOTIFY/LISTEN: טריגר ב-PostgreSQL שולח התראה אטומית, ושירות Bridge (Sidecar) מאזין ומעביר אותה ל-NATS
.
Deduplication: שימוש ב-Nats-Msg-Id דטרמיניסטי (EntityID + Version) למניעת כפילויות בהפצה ב-Mesh
.
4.3 NATS JetStream & Sensors
שימוש ב-Leaf Nodes למניעת תלות ב-Quorum
.
Delta Updates: ה-UI מקבל רק את הישויות שהשתנו (version > last_seen)
.
Queue Groups: שימוש בקבוצות תור ב-NATS למניעת כפילות חישוב בין מחשבים (רק מחשב אחד מעבד נתון סנסור ספציפי)
.
5. ניהול מחזור חיים (Lifecycle)
5.1 מחיקה היברידית (Hybrid Deletion)
מחיקת ישות בודדת: שימוש ב-Tombstones (דגל is_deleted = true) כדי שה-UI יקבל את העדכון בדלתא ויסיר את האובייקט מהמפה
.
מחיקה גורפת (משימה/תשתית): עדכון deleted_at בטבלת האב בלבד. ה-View של המפה (v_active_entities) מבצע JOIN ומסנן את כל הילדים ברמת השליפה (View Masking) למניעת סערת כתיבה ברשת
.
Garbage Collection: מחיקה פיזית (Hard Delete) של נתונים ישנים (מעל 10 דקות) ע"י Background Worker
.
5.2 שכפול נתונים
ביצוע Deep Copy של משימות באמצעות CTE (Common Table Expressions) ישירות בתוך ה-DB
. אין להוציא את הנתונים לאפליקציה ובחזרה
.
6. ממשק משתמש (UI/WebGL) וביצועים
Shader-Ready Data: ה-DB יכין את הנתונים כ-Payload "לעוס" (DTO מוכן) באמצעות jsonb_agg כדי למנוע Parsing כבד בדפדפן
.
Flow Control: הגדרת MaxAckPending ו-Rate Limit ב-NATS כדי למנוע הצפת ה-UI בהודעות
.
Schema Versioning: הוספת schema_version לכל ישות לטיפול בתאימות לאחור וביצוע Migrations אטומיים בעת טעינת משימות ישנות
.
7. הנחיות למימוש טכני (מדריך לסוכן)
בניית ה-Schema: צור טבלאות עם UUID, עמודות גרסה (version), ו-Constraints סמנטיים
.
יצירת Views: תמיד ספק View לשכבת ה-UI שמסנן מחיקות לוגיות ומבצע אופטימיזציה ל-JSON
.
טריגרים: ממש טריגרים לקידום ה-Version של הישות וה-Sequence של האב בכל שינוי
.
NATS Configuration: הגדר Streams כ-Ring Buffer עם Discard Old למניעת חריגת זיכרון
.
Documentation: השתמש ב-AsyncAPI לתיעוד מבנה ההודעות ב-NATS
.

--------------------------------------------------------------------------------
זכור: השרידות היא מעל הכל. כל רכיב שאתה בונה חייב לתפקד גם אם המחשב מנותק פיזית משאר הרשת
.
תעבוד עם המשתמש באנגלית