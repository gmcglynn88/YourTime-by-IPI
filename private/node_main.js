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

APP.set('views', JOIN(__dirname, "../public", 'views')); // Points to public/views
APP.use(EXPRESS.static(JOIN(__dirname, "../public"))); // Serve static files from 'public'
APP.set('view engine', 'ejs'); // Use EJS as the view engine

// Function to fetch access token
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

// Fetch the balances data
const getBalancesData = async (token) => {
    const response = await AXIOS({
        url: 'https://api.mypurecloud.ie/api/v2/flows/datatables/3bcf89ba-8aed-4fdb-b143-a726c3887a27/rows?showbrief=false',
        method: 'get',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });

    return response.data.entities.reduce((acc, data) => {
        const name = data.Name;
        acc[name] = [{
            agentName: name,
            team: data['Work Team'],
            managementUnit: data['Management Unit'],
            holidayCurrentYear: data['Remaining Holiday Balance (Current Year)'],
            holidayNextYear: data['Remaining Holiday Balance (Next Year)'],
            timeOffInLieu: data.TOIL
        }];
        return acc;
    }, {});
};

// Fetch time-off requests
const getTimeOffRequestsData = async (token) => {
    const managementUnits = await getManagementUnits(token); 
    const teams = await getTeams(token);

    const teamMembers = {};
    for (const team of teams) {
        const members = await getTeamMembers(token, team.id);
        teamMembers[team.id] = members.map(member => member.id);
    }

    const timeOffRequests = {};

    for (const unit of managementUnits) {
        const users = await getUsersInManagementUnit(token, unit.id);

        for (const user of users) {
            const userDetails = await getUserDetails(token, user.id);
            const requests = await getTimeOffRequests(token, unit.id, user.id);

            if (!timeOffRequests[userDetails.name]) {
                timeOffRequests[userDetails.name] = [];
            }

            const formattedRequests = formatTimeOffRequests(userDetails, unit.name, requests);

            let teamName = 'Unknown';
            for (const [teamId, members] of Object.entries(teamMembers)) {
                if (members.includes(user.id)) {
                    const team = teams.find(t => t.id === teamId);
                    teamName = team ? team.name : 'Unknown';
                    break;
                }
            }

            formattedRequests.forEach(request => {
                request.team = teamName;
            });

            timeOffRequests[userDetails.name].push(...formattedRequests);
        }
    }

    return timeOffRequests;
};

// Route to render 'template.ejs'
APP.get('/', async (req, res) => {
    try {
        const token = await getAccessToken();
        const balancesData = await getBalancesData(token);
        const timeOffRequests = await getTimeOffRequestsData(token);

        res.render("template", {
            userdata: balancesData,
            detailsData: timeOffRequests
        });
    } catch (err) {
        console.error('Error fetching data or rendering template:', err);
        res.status(500).send("Something went wrong when accessing or processing Genesys APIs");
    }
});

// Handle CSV file uploads
APP.post('/upload', upload.single('csvFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const results = [];
    FS.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => {
            sendDataToGenesys(results)
                .then(() => res.send('File uploaded and processed successfully'))
                .catch(error => res.status(500).send('Error processing file: ' + error.message));
        });
});

// Function to send data to Genesys Cloud API
const sendDataToGenesys = async (data) => {
    const token = await getAccessToken();
    const datatableId = '3bcf89ba-8aed-4fdb-b143-a726c3887a27';
    const url = `https://api.mypurecloud.ie/api/v2/flows/datatables/${datatableId}/rows`;

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
            await AXIOS.post(url, convertedRow, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log('Data sent to Genesys:', convertedRow);
        } catch (error) {
            console.error('Error sending data to Genesys:', error);
            throw error;
        }
    }
};

// Fetch management units
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

// Fetch teams
const getTeams = async (token) => {
    const response = await AXIOS({
        url: 'https://api.mypurecloud.ie/api/v2/teams',
        method: 'get',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data.entities;
};

// Fetch team members
const getTeamMembers = async (token, teamId) => {
    const response = await AXIOS({
        url: `https://api.mypurecloud.ie/api/v2/teams/${teamId}/members`,
        method: 'get',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data.entities;
};

// Fetch users in a management unit
const getUsersInManagementUnit = async (token, managementUnitId) => {
    const response = await AXIOS({
        url: `https://api.mypurecloud.ie/api/v2/workforcemanagement/managementunits/${managementUnitId}/users`,
        method: 'get',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data.entities;
};

// Fetch user details
const getUserDetails = async (token, userId) => {
    const response = await AXIOS({
        url: `https://api.mypurecloud.ie/api/v2/users/${userId}`,
        method: 'get',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
};

// Fetch time-off requests for a user
const getTimeOffRequests = async (token, managementUnitId, userId) => {
    try {
        const response = await AXIOS({
            url: `https://api.mypurecloud.ie/api/v2/workforcemanagement/managementunits/${managementUnitId}/users/${userId}/timeoffrequests`,
            method: 'get',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        return response.data.timeOffRequests;
    } catch (error) {
        console.error(`Error fetching time off requests for user ID ${userId}:`, error.response ? error.response.data : error.message);
        return [];
    }
};

// Format time-off requests
const formatTimeOffRequests = (userDetails, managementUnitName, requests) => {
    return requests.map(request => ({
        agentName: userDetails.name,
        team: userDetails.team,
        managementUnit: managementUnitName,
        timeOffStart: request.fullDayManagementUnitDates[0],
        timeOffEnd: request.fullDayManagementUnitDates[request.fullDayManagementUnitDates.length - 1],
        balanceDeduction: request.durationMinutes.reduce((acc, minutes) => acc + minutes, 0) / 60
    }));
};

// Existing server setup
var server = HTTP.createServer(APP);
server.listen(ENV.PORT || 3000, () => {
    console.log('Server is running');
});
