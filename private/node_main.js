const HTTP = require('http');
const EXPRESS = require('express');
const AXIOS = require('axios');
const { env: ENV } = require('process');
const { join: JOIN } = require('path');
const FS = require('fs');
const multer = require('multer');
const csv = require('csv-parser');
const qs = require('qs');
const Buffer = require('buffer').Buffer;

const APP = EXPRESS();
const upload = multer({ dest: 'uploads/' });

// Set up the views directory and EJS as the view engine
APP.set('views', JOIN(__dirname, '..', 'public', 'views'));  // Points to public/views
APP.use(EXPRESS.static(JOIN(__dirname, "../public")));  // Serve static files from 'public'
APP.set('view engine', 'ejs');  // Use EJS as the view engine

// Simulating userdata to pass to template
const userdata = {
    "John Doe": [
        {
            agentName: "John Doe",
            team: "Team A",
            managementUnit: "Unit A",
            holidayCurrentYear: 15,
            holidayNextYear: 20,
            timeOffInLieu: 5
        }
    ],
    "Jane Smith": [
        {
            agentName: "Jane Smith",
            team: "Team B",
            managementUnit: "Unit B",
            holidayCurrentYear: 18,
            holidayNextYear: 22,
            timeOffInLieu: 3
        }
    ]
};

// Route to render 'template.ejs'
APP.get('/', (req, res) => {
    // Passing userdata to the template
    res.render('template', { userdata: userdata });
});

// API call to get access token
const getAccessToken = async () => {
    const clientId = 'cad3d0b4-0258-48a9-8a82-4ebdf9f9a0ff';
    const clientSecret = 'dBngyn4mG2Pu-lT4S_FLs23_8VhFyVYV-eNEbFYTFAY';
    const authString = `${clientId}:${clientSecret}`;
    const encodedAuthString = Buffer.from(authString).toString('base64');

    try {
        const response = await AXIOS({
            method: 'post',
            url: 'https://apps.mypurecloud.ie/oauth/token',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${encodedAuthString}`
            },
            data: qs.stringify({
                'grant_type': 'client_credentials'
            })
        });
        console.log('Access token fetched successfully:', response.data.access_token);
        return response.data.access_token;
    } catch (error) {
        console.error('Error fetching access token:', error.response ? error.response.data : error.message);
        throw error;
    }
};

// Handle CSV file uploads and process data
APP.post('/upload', upload.single('csvFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const results = [];
    FS.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => {
            // Process the CSV data and send it to Genesys data table
            console.log(results);
            sendDataToGenesys(results)
                .then(() => {
                    res.send('File uploaded and processed successfully');
                })
                .catch(error => {
                    res.status(500).send('Error processing file: ' + error.message);
                });
        });
});

// Function to send data to Genesys Cloud API
const sendDataToGenesys = async (data) => {
    const token = await getAccessToken();
    const datatableId = '3bcf89ba-8aed-4fdb-b143-a726c3887a27';  // Replace with your actual datatableId
    const url = `https://api.euw2.pure.cloud/api/v2/flows/datatables/${datatableId}/rows`;

    // Convert data types and send each row
    for (const row of data) {
        const convertedRow = {
            key: row.key,
            Name: row.Name,
            TOIL: parseInt(row.TOIL, 10),
            "Remaining Holiday Balance (Current Year)": parseInt(row["Remaining Holiday Balance (Current Year)"], 10),
            "Remaining Holiday Balance (Next Year)": parseInt(row["Remaining Holiday Balance (Next Year)"], 10),
            "Wage ID": parseInt(row["Wage ID"], 10),
            "Contract Hours": parseInt(row["Contract Hours"], 10),
            "Management Unit": row["Management Unit"],
            "Work Team": row["Work Team"]
        };

        try {
            const response = await AXIOS.post(url, convertedRow, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log('Data sent to Genesys:', response.data);
        } catch (error) {
            console.error('Error sending data to Genesys:', error);
            throw error;
        }
    }
};

// Function to fetch management units from Genesys
const getManagementUnits = async (token) => {
    const response = await AXIOS({
        url: 'https://api.mypurecloud.ie/api/v2/workforcemanagement/managementunits',
        method: 'get',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data.entities;
};

// Server setup
var server = HTTP.createServer(APP);
server.listen(ENV.PORT || 3000, () => {
    console.log('Server is running on port 3000');
});
