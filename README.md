# AutoOffloadInput

This tool automates the process of:

1.  **PSA Data**: Fetching card details (Name, Number, Grade) from PSA (via API or read from website).
2.  **Card Ladder**: Read "Card Ladder Value" from [CardLadder.com](https://www.cardladder.com).
3.  **Google Sheets**: Updating a Google Sheet with the results.

## Features

- **PSA Integration**:
    - Uses **PSA Public API** (fast/reliable) if an API key is provided.
    - Falls back to reading from website (safe/isolated tab) if the API fails or is missing.
    - Populates "Card Name", "Card Number", and "Grade" if empty.
    - Smartly parses grades (e.g., converts "GEM MT 10" to number `10`).
- **Card Ladder Automation**:
    - **Automated Login**: Uses credentials from `.env` to log in automatically.
    - **Manual Fallback**: If no credentials are found, pauses for manual login.
    - **Values**: Scrapes the market value and rounds it **UP** to the nearest dollar.

## Prerequisites

- [Node.js](https://nodejs.org/) installed on your computer.
- A Google Cloud Project with a Service Account.

## Setup Guide

### 1. Google Sheets API Setup

To allow the script to read/write to your sheet, you need a Service Account.

1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Create a new project (or select an existing one).
3.  Search for **"Google Sheets API"** in the search bar and click **Enable**.
4.  Go to **IAM & Admin** > **Service Accounts**.
5.  Click **Create Service Account**, give it a name (e.g., "CardBot"), and click **Create & Continue**.
6.  (Optional) Grant "Editor" access in the IAM setup if asked, but it's not strictly necessary here.
7.  Click _Done_.
8.  In the Service Accounts list, click on your new account (the email address).
9.  Go to the **Keys** tab > **Add Key** > **Create new key** > **JSON**.
10. A `.json` file will download. **Keep this safe!** You will need the `client_email` and `private_key` from inside it.

### 2. Share Your Sheet

1.  Open your Google Sheet or CSV in Google Sheets.
2.  Click **Share** in the top right.
3.  Copy the `client_email` from your JSON file (e.g., `cardbot@project-123.iam.gserviceaccount.com`).
4.  Paste it into the Share box and give it **Editor** permissions.

### 3. Project Configuration

1.  Install dependencies:
    ```bash
    npm install
    ```
2.  Create a `.env` file (copy `.env.example`):

    ```ini
    # Google Sheets Auth
    GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account-email@...
    GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
    SHEET_ID=your_sheet_id_here

    # PSA Integration (Optional but Recommended)
    PSA_API_KEY=your_psa_public_api_key

    # Card Ladder Login (Optional - for auto-login)
    CL_USER=your_email@example.com
    CL_PASS=your_password

    # Row Limits (Optional)
    # START_ROW=2   (Start from specific row, defaults to 2)
    # END_ROW=100   (Stop at specific row, defaults to end of sheet)

    # Write Mode (Optional)
    # Options: BOTH (Default), PSA, CL
    WRITE_MODE=BOTH

    # Card Ladder Value Choice (Optional)
    # Options: RAW (Default), HIGHER
    # RAW: Use the exact value from Card Ladder (rounded up).
    # HIGHER: Use the higher of (Average Price) vs (Card Ladder Value).
    CL_VALUE_CHOICE=RAW

    # Skip CL Check (Optional)
    # If true, skips CL scrape if a value already exists in the sheet.
    SKIP_CL_CHECK=true
    ```

## Usage

0. Make sure you've updated the SHEET_ID in the .env file to your proper google sheet ID.
1. Run the script:
    ```bash
    node index.js
    ```
2. **Login Phase**:
    - **Auto**: If `CL_USER/PASS` are set, it will log in and navigate to Sales History automatically.
    - **Manual**: If not set, it will pause. Log in manually in the browser, then press **ENTER** in the terminal.
3. **Processing**:
    - The script will iterate through rows.
    - **PSA**: If metadata (Name/Number/Grade) is missing, it fetches it first.
    - **Card Ladder**: Matches the cert and updates the value.
    - Stops after `MAX_ROWS` (default 10, configurable in `index.js`).

## Troubleshooting

- **"The caller does not have permission"**: Share the sheet with the Service Account email.
- **"Login failed"**: Check your `CL_USER` and `CL_PASS`. If auto-login struggles, remove them from `.env` to use manual mode.
- **"Column not found"**: Ensure headers match: `"Certification Number"`, `"CL Market Value When Paid"`, `"Card Name"`, `"Card Number"`, `"Grade"`.
