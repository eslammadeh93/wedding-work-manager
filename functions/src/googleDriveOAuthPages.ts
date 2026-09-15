import { onRequest } from 'firebase-functions/v2/https';

const baseUrl = 'https://us-central1-wedding-work-manager-d6628.cloudfunctions.net/googleDriveOAuthPages';
const supportEmail = 'eslam.madeh93@gmail.com';

const layout = (title: string, content: string) => `<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} | Wedding Work Manager</title>
  <style>
    :root{color-scheme:light dark}body{margin:0;background:#f7f4ee;color:#172033;font:16px/1.75 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:820px;margin:48px auto;padding:32px;background:#fff;border:1px solid #e7dfd0;border-radius:18px;box-shadow:0 12px 36px #17203312}h1,h2{line-height:1.3;color:#0f2748}h1{margin-top:0}a{color:#3157b7}nav{display:flex;flex-wrap:wrap;gap:16px;margin:24px 0;padding:14px 0;border-block:1px solid #e7dfd0}.muted{color:#647084}.ar{direction:rtl;text-align:right;margin-top:32px;padding-top:24px;border-top:1px solid #e7dfd0}@media(max-width:700px){main{margin:0;padding:24px;border:0;border-radius:0}}@media(prefers-color-scheme:dark){body{background:#0b1424;color:#dbe4f2}main{background:#111d30;border-color:#2b3950}h1,h2{color:#f5d889}nav,.ar{border-color:#2b3950}.muted{color:#9ba9bd}a{color:#9db8ff}}
  </style>
</head>
<body><main>${content}</main></body>
</html>`;

const navigation = `<nav><a href="${baseUrl}">Home</a><a href="${baseUrl}/privacy">Privacy Policy</a><a href="${baseUrl}/terms">Terms of Service</a></nav>`;

const homePage = layout('Home', `
  <h1>Wedding Work Manager</h1>
  <p>Wedding Work Manager is a business operations application for wedding-service companies. It helps authorized company teams manage orders, customers, workers, inventory, expenses, schedules, and design-image links.</p>
  <p>When a company administrator chooses to connect Google Drive, the application uses the limited <code>drive.file</code> permission to upload order design images selected by that user into the company's chosen Drive folder. The application does not request access to unrelated Drive files.</p>
  ${navigation}
  <p class="muted">Support: <a href="mailto:${supportEmail}">${supportEmail}</a></p>
  <section class="ar"><h2>مدير أعمال الويدينج</h2><p>تطبيق لإدارة أعمال شركات خدمات الأفراح، يشمل الأوردرات والعملاء والعمال والمخزون والمصروفات والمواعيد. عند اختيار ربط Google Drive، يستخدم التطبيق صلاحية محدودة لرفع صور تصميمات الأوردرات التي يختارها المستخدم إلى الفولدر المحدد فقط.</p></section>
`);

const privacyPage = layout('Privacy Policy', `
  <h1>Privacy Policy</h1>
  <p class="muted">Effective date: September 15, 2026</p>
  ${navigation}
  <h2>Information we process</h2>
  <p>Wedding Work Manager processes account and company-management information supplied by authorized users, including orders, customers, workers, inventory, expenses, and operational activity. When Google Drive is connected, we process the selected folder identifier, an encrypted OAuth refresh token, identifiers and links for files uploaded through the application, and the image content selected for upload.</p>
  <h2>How Google user data is used</h2>
  <p>Google Drive access is used only to provide the user-facing automatic image upload and deletion features requested by an authorized company user. The app requests the limited <code>https://www.googleapis.com/auth/drive.file</code> scope and does not read or manage unrelated files in the user's Drive.</p>
  <h2>Storage, security, and sharing</h2>
  <p>OAuth refresh tokens are encrypted at rest and are handled only by server-side functions. We do not sell Google user data or use it for advertising. Data is shared only with infrastructure providers necessary to operate the service, including Google Cloud and Firebase, or when required by law.</p>
  <h2>Retention and deletion</h2>
  <p>The connection token is deleted from the application when an administrator disconnects Google Drive. Files already uploaded remain in the user's Google Drive unless the user deletes them; deleting an eligible uploaded image through the app moves that file to Drive trash. Users may also revoke access from their Google Account permissions at any time.</p>
  <h2>Limited Use</h2>
  <p>Wedding Work Manager's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.</p>
  <h2>Contact</h2>
  <p>For privacy questions or deletion requests, contact <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>
  <section class="ar"><h2>ملخص بالعربية</h2><p>يستخدم التطبيق صلاحية Google Drive المحدودة فقط لرفع وحذف صور الأوردرات التي يختارها المستخدم داخل فولدر الشركة المحدد. يتم تشفير رمز الربط، ولا يتم بيع بيانات Google أو استخدامها للإعلانات. عند إلغاء الربط يُحذف رمز الربط من التطبيق، ويمكن للمستخدم إلغاء الصلاحية من حساب Google في أي وقت.</p></section>
`);

const termsPage = layout('Terms of Service', `
  <h1>Terms of Service</h1>
  <p class="muted">Effective date: September 15, 2026</p>
  ${navigation}
  <p>Wedding Work Manager is provided to authorized wedding-service businesses and their approved team members for legitimate business operations. Users must protect their account credentials, upload only content they are authorized to use, and comply with applicable laws and Google Drive terms.</p>
  <p>Google Drive integration is optional and may be disconnected at any time. Users remain responsible for files stored in their own Drive account and for maintaining appropriate backups. The service may be updated or temporarily unavailable for maintenance, security, or third-party provider interruptions.</p>
  <p>For questions about these terms, contact <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>
  <section class="ar"><h2>ملخص بالعربية</h2><p>الخدمة مخصصة للاستخدام التجاري المشروع من الشركات وأعضاء فرقها المصرح لهم. يتحمل المستخدم مسؤولية بيانات الدخول والمحتوى الذي يرفعه، ويمكنه إلغاء ربط Google Drive في أي وقت.</p></section>
`);

export const googleDriveOAuthPages = onRequest({ region: 'us-central1', invoker: 'public', maxInstances: 1, cpu: 'gcf_gen1' }, (request, response) => {
  response.set('Cache-Control', 'public, max-age=300');
  response.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  response.type('html');
  if (request.path === '/privacy' || request.path.endsWith('/privacy')) { response.status(200).send(privacyPage); return; }
  if (request.path === '/terms' || request.path.endsWith('/terms')) { response.status(200).send(termsPage); return; }
  if (request.path === '/' || request.path === '') { response.status(200).send(homePage); return; }
  response.status(404).send(layout('Not Found', `<h1>Page not found</h1>${navigation}`));
});
