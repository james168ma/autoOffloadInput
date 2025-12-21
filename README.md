# AutoOffloadInput

This tool automates the process of reading Certification Numbers from a Google Sheet, taking their "Card Ladder Value" from [CardLadder.com](https://www.cardladder.com), and writing the result back to the sheet.

## Features
-   **Dynamic Column Detection**: Automatically finds "Certification Number" and "CL Market Value When Paid" columns.
-   **Manual Login Support**: Pauses to allow you to log in to Card Ladder securely in the browser.
-   **Smart Updates**: Only fills empty cells. If a cell is filled, it verifies the value and alerts you of mismatches.
-   **Anti-Detection**: Uses stealth plugins to behave like a real browser.

## Prerequisites
-   [Node.js](https://nodejs.org/) installed on your computer.
-   A Google Cloud Project with a Service Account (details below).

## Setup Guide

### 1. Google Sheets API Setup
To allow the script to read/write to your sheet, you need a Service Account.

1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Create a new project (or select an existing one).
3.  Search for **"Google Sheets API"** in the search bar and click **Enable**.
4.  Go to **IAM & Admin** > **Service Accounts**.
5.  Click **Create Service Account**, give it a name (e.g., "CardBot"), and click **Create & Continue**.
6.  (Optional) Grant "Editor" access in the IAM setup if asked, but it's not strictly necessary here.
7.  Click *Done*.
8.  In the Service Accounts list, click on your new account (the email address).
9.  Go to the **Keys** tab > **Add Key** > **Create new key** > **JSON**.
10. A `.json` file will download. **Keep this safe!** You will need the `client_email` and `private_key` from inside it.

### 2. Share Your Sheet
1.  Open your Google Sheet or CSV in Google Sheets.
2.  Click **Share** in the top right.
3.  Copy the `client_email` from your JSON file (e.g., `cardbot@project-123.iam.gserviceaccount.com`).
4.  Paste it into the Share box and give it **Editor** permissions.

### 3. Project Configuration
1.  Open this project folder in VS Code or Terminal.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Create a new file named `.env` (copy `.env.example`).
4.  Fill in your details:

    ```ini
    # .env file content
    GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account-email@...
    
    # Copy the PRIVATE KEY exactly as is from the JSON file, including the -----BEGIN... and \n parts
    GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
    
    # The ID of your Google Sheet (from the URL)
    # https://docs.google.com/spreadsheets/d/THIS_PART_IS_THE_ID/edit
    SHEET_ID=1rMarcJlKb5LOUKLvWVK...
    ```

## Usage

0. Make sure you've updated the SHEET_ID in the .env file to your google sheet ID.
1.  Run the script:
    ```bash
    node index.js
    ```
2.  A Chromium browser window will open.
3.  **Action Required**: The script will pause. Use the browser window to log in to Card Ladder manually.
4.  Once you are logged in, go to the sales history tab in card ladder, then switch back to the terminal and **press ENTER**.
5.  The script will now cycle through your sheet, getting values and updating Column E automatically.

## Troubleshooting
-   **"The caller does not have permission"**: You forgot to Share the sheet with the Service Account email.
-   **"Cloudflare loop"**: The script uses stealth mode, but if you get stuck, try solving the captcha manually during the login pause.
-   **"Column not found"**: Ensure your sheet has headers named exactly `"Certification Number"` and `"CL Market Value When Paid"`.
