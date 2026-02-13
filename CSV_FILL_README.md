# CSV Processing Script Setup & Usage

This guide explains how to use the `process_csv.js` script to fill Card Ladder and PSA data into a CSV file.

## Prerequisites

1.  **Node.js**: Ensure Node.js is installed.
2.  **Dependencies**: Run `npm install` to install required packages.

## Configuration

The script uses a `.env` file for configuration. Ensure the following variables are set in your `.env` file:

```ini
# Card Ladder Credentials (REQUIRED)
CL_USER=your_email@example.com
CL_PASS=your_password
CL_API_KEY=your_api_key

# PSA API Integration (Optional, only use if we have enough credits)
PSA_API_KEY=your_psa_api_key
```

## CSV Format

The input CSV file must contain a header row with at least the following column:
*   `Certification Number`: The cert number of the card to lookup.

Other columns are optional but should be present if you want them filled:
*   `Card Name`
*   `Card Number`
*   `Grade`
*   `CL Market Value`
*   `CL Confidence Level`

**Example:**

```csv
#,Card Name,Card Number,Grade,Certification Number,CL Market Value,CL Confidence Level,OWNERSHIP,QC Pass?,Date Added
1,,,,133548817,,,rose,,2/9
2,,,,133548812,,,rose,,2/9
```

*Note: The script supports empty lines before the header row.*

## Usage

To run the script, use the following command:

```bash
node process_csv.js <path_to_input_csv>
```

**Example:**

```bash
node process_csv.js sample_raw_data.csv
```

## Output

The script will create a new file named `<filename>_filled.csv` in the same directory as the input file.
*   **Example Output**: `sample_raw_data_filled.csv`

**Filled Example:**

```csv
#,Card Name,Card Number,Grade,Certification Number,CL Market Value,CL Confidence Level,OWNERSHIP,QC Pass?,Date Added
1,MIMIKYU-HOLO,136,8,133548817,9,5,rose,,2/9
2,MIMIKYU-HOLO,136,9,133548812,24,5,rose,,2/9
```

## Features

*   **Iterative Saving**: The script saves progress row-by-row. If you interrupt the script (Ctrl+C), you can verify the data processed so far in the `_filled.csv` file.
*   **Resume Capability**: Currently, the script does **not** automatically skip processed rows if you restart. It checks if the output file exists and appends to it. For a clean restart, delete the `_filled.csv` file. *To extend this, future versions could check the last cert in the output file.*
*   **Authentication**: Automatically logs in to Card Ladder using the credentials in `.env`.

## Troubleshooting

*   **Login Failed**: Check your `CL_USER` and `CL_PASS` in `.env`.
*   **Input file not found**: Ensure the path to your CSV file is correct.
*   **Puppeteer Errors**: If the browser crashes or fails to launch, try deleting the `user_data` directory to clear the cache.
