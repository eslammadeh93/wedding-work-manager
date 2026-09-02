# Google Drive automatic uploads

This integration keeps image files in each company's Google Drive folder. Firebase stores only the order's Drive link and an encrypted server-side connection token.

## One-time Google setup

1. In the Google Cloud project used for this Firebase project, enable the **Google Drive API**.
2. Configure the OAuth consent screen. Add your company administrators as test users until the consent screen is published.
3. Create an OAuth 2.0 **Web application** client.
4. Add this exact authorized redirect URI:

   `https://us-central1-wedding-work-manager-d6628.cloudfunctions.net/googleDriveOAuthCallback`

5. Store the three required secrets. Generate a long random value for the encryption key; it must be kept private.

   ```powershell
   firebase functions:secrets:set GOOGLE_DRIVE_CLIENT_ID
   firebase functions:secrets:set GOOGLE_DRIVE_CLIENT_SECRET
   firebase functions:secrets:set GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY
   ```

## Deploy and connect a company

1. Deploy the changed functions and Hosting bundle:

   ```powershell
   firebase deploy --only functions,hosting
   ```

2. A company manager opens **Settings**, enters their Google Drive folder URL, and selects **Connect Google Drive**.
3. The manager signs in with the Google account that owns (or can edit) that folder and accepts the requested upload permission.
4. Employees with order-write permission can then select an image inside a new order. The application uploads it to that company's connected folder and fills the image link automatically.

## Privacy and limits

- Keep the Drive folder **Restricted**. Employees do not need Google Drive permissions to upload through the application.
- The linked Google account is the only Drive account that requires folder access.
- Uploads currently accept JPG, PNG, WEBP, HEIC, and HEIF images up to 6 MB each.
- Disconnecting Google Drive in Settings immediately stops automatic uploads for that company.
