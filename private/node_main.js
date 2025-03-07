const HTTP = require('http');
const EXPRESS = require('express');
const AXIOS = require('axios');
const {env: ENV} = require('process');
const {join: JOIN} = require('path');
const FS = require('fs');
const multer = require('multer');
const csv = require('csv-parser');
const qs = require('qs');
const Buffer = require('buffer').Buffer;

const APP = EXPRESS();
const upload = multer({ dest: 'uploads/' });

APP.set('views', JOIN(__dirname, "../public", 'views'));
APP.use(EXPRESS.static(JOIN(__dirname, "../public")));
APP.set('view engine', 'ejs');

const fetchFile = (req, res, next) => {
    FS.readFile(JOIN(__dirname, "../public", "views", "template.ejs"), 'utf8', (err, data) => {
        if (err) {
            console.log(err);
        }
        req.file_data = data;
        next();
    });
};
APP.use(fetchFile);



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

const express = require('express');

APP.use(express.json());
APP.use(express.urlencoded({ extended: true }));

APP.post('/add-entry', async (req, res) => {
    const data = req.body;
    
    const convertedRow = {
        key: data.key,
        Name: data.name,
        TOIL: parseInt(data.toil, 10),
        "Remaining Holiday Balance (Current Year)": parseInt(data.holidayCurrentYear, 10),
        "Remaining Holiday Balance (Next Year)": parseInt(data.holidayNextYear, 10),
        "Wage ID": parseInt(data.wageId, 10),
        "Contract Hours": parseInt(data.contractHours, 10),
        "Management Unit": data.managementUnit,
        "Work Team": data.workTeam
    };
    
    try {
        await sendDataToGenesys([convertedRow]);
        res.send('Entry added successfully');
    } catch (error) {
        res.status(500).send('Error adding entry: ' + error.message);
    }
});

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

const sendDataToGenesys = async (data) => {
    const token = await getAccessToken();
    const datatableId = '3bcf89ba-8aed-4fdb-b143-a726c3887a27'; // Replace with your actual datatableId
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
        // console.log(`Full response for time off requests for user ID ${userId} in management unit ID ${managementUnitId}:`, response.data);
        return response.data.timeOffRequests;
    } catch (error) {
        console.error(`Error fetching time off requests for user ID ${userId} in management unit ID ${managementUnitId}:`, error.response ? error.response.data : error.message);
        return [];
    }
};

const formatTimeOffRequests = (userDetails, managementUnitName, requests) => {
    return requests.map(request => ({
        agentName: userDetails.name,
        team: userDetails.team, // Assuming userDetails contains team information
        managementUnit: managementUnitName,
        timeOffStart: request.fullDayManagementUnitDates[0],
        timeOffEnd: request.fullDayManagementUnitDates[request.fullDayManagementUnitDates.length - 1],
        balanceDeduction: request.durationMinutes.reduce((acc, minutes) => acc + minutes, 0) / 60 // Assuming durationMinutes is in minutes
    }));
};


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

APP.get('/teams', async (req, res) => {
    try {
        const token = await getAccessToken();
        const teams = await getTeams(token);
        const teamList = teams.map(team => ({
            id: team.id,
            name: team.name
        }));
        console.log('Teams fetched successfully:', teamList);
        res.status(200).send(teamList);
    } catch (error) {
        console.error('Error fetching teams:', error.response ? error.response.data : error.message);
        res.status(500).send("Something went wrong when fetching teams");
    }
});

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

APP.get('/timeoffrequests', async (req, res) => {
    try {
        const token = await getAccessToken();
        const managementUnits = await getManagementUnits(token);
        const teams = await getTeams(token); // Fetch all teams

        const teamMembers = {};
        for (const team of teams) {
            const members = await getTeamMembers(token, team.id);
            teamMembers[team.id] = members.map(member => member.id);
        }

        const timeOffRequests = {};
        const balancesData = await getBalancesData(token); // Fetch balances data

        for (const unit of managementUnits) {
            // console.log(`Fetching users for management unit: ${unit.name}`);
            const users = await getUsersInManagementUnit(token, unit.id);
            // console.log(`Users fetched for management unit ${unit.name}:`, users);

            for (const user of users) {
                const userDetails = await getUserDetails(token, user.id);
                // console.log(`Fetching time off requests for user: ${userDetails.name} (ID: ${user.id}) in management unit: ${unit.name}`);
                const requests = await getTimeOffRequests(token, unit.id, user.id);
                // console.log(`Time off requests for user ${userDetails.name}:`, requests);

                if (!timeOffRequests[userDetails.name]) {
                    timeOffRequests[userDetails.name] = [];
                }

                const formattedRequests = formatTimeOffRequests(userDetails, unit.name, requests);

                // Add team information from teamMembers
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

        // console.log('Final time off requests data:', JSON.stringify(timeOffRequests, null, 2));
        res.render("template", { detailsData: timeOffRequests });
    } catch (error) {
        console.error('Error fetching time off requests:', error.response ? error.response.data : error.message);
        res.status(500).send("Something went wrong when fetching time off requests");
    }
});

// Function to fetch balances data
const getBalancesData = async (token) => {
    const response = await AXIOS({
        url: 'api.mypurecloud.ie/api/v2/flows/datatables/3bcf89ba-8aed-4fdb-b143-a726c3887a27/rows?showbrief=false',
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

APP.get('/timeoffrequests-data', async (req, res) => {
    try {
        const token = await getAccessToken();
        const managementUnits = await getManagementUnits(token);
        const teams = await getTeams(token); // Fetch all teams

        const teamMembers = {};
        for (const team of teams) {
            const members = await getTeamMembers(token, team.id);
            teamMembers[team.id] = members.map(member => member.id);
        }

        const timeOffRequests = {};
        const balancesData = await getBalancesData(token); // Fetch balances data

        for (const unit of managementUnits) {
            console.log(`Fetching users for management unit: ${unit.name}`);
            const users = await getUsersInManagementUnit(token, unit.id);
            console.log(`Users fetched for management unit ${unit.name}:`, users);

            for (const user of users) {
                const userDetails = await getUserDetails(token, user.id);
                console.log(`Fetching time off requests for user: ${userDetails.name} (ID: ${user.id}) in management unit: ${unit.name}`);
                const requests = await getTimeOffRequests(token, unit.id, user.id);
                console.log(`Time off requests for user ${userDetails.name}:`, requests);

                if (!timeOffRequests[userDetails.name]) {
                    timeOffRequests[userDetails.name] = [];
                }

                const formattedRequests = formatTimeOffRequests(userDetails, unit.name, requests);

                // Add team information from teamMembers
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

        console.log('Final time off requests data:', JSON.stringify(timeOffRequests, null, 2));
        res.status(200).send(timeOffRequests);
    } catch (error) {
        console.error('Error fetching time off requests:', error.response ? error.response.data : error.message);
        res.status(500).send("Something went wrong when fetching time off requests");
    }
});

// Existing routes and code
APP.get('/', (req, res) => {
    res.sendFile(JOIN(__dirname, "../public", 'main.html')); 
    // res.render('main');
});

APP.get('/your-time', async (req, res) => {
    getAccessToken().then((token) => {
        AXIOS({
            url: 'https://api.mypurecloud.ie/api/v2/flows/datatables/3bcf89ba-8aed-4fdb-b143-a726c3887a27/rows?showbrief=false',
            method: 'get',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        }).then(resp => resp)
        .then(resp => {
            console.log('API response data:', resp.data);
            const balancesData = resp.data.entities.reduce((acc, data) => {
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
            console.log('Processed balancesData:', balancesData);
            return balancesData;
        }).then(balancesData => {
            console.log('Final balancesData:', balancesData);
            res.render("template", { userdata: balancesData });
        }).catch(err => {
            console.error('Error processing API response:', err);
            res.status(500).send("Something went wrong when accessing or processing Genesys APIs");
        });
    }).catch(err => {
        console.error('Error fetching access token:', err);
        res.status(500).send("Something went wrong when fetching access token");
    });
});

APP.get('/your-time-data', async (req, res) => {
    getAccessToken().then((token) => {
        AXIOS({
            url: 'https://api.mypurecloud.ie/api/v2/flows/datatables/3bcf89ba-8aed-4fdb-b143-a726c3887a27/rows?showbrief=false',
            method: 'get',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        }).then(resp => resp)
        .then(resp => {
            console.log('API response data:', resp.data);
            const balancesData = resp.data.entities.reduce((acc, data) => {
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
            console.log('Processed balancesData:', balancesData);
            return balancesData;
        }).then(balancesData => {
            console.log("success");
            res.status(200).send(balancesData);
        }).catch(err => {
            console.error('Error processing API response:', err);
            res.status(500).send("Something went wrong when accessing or processing Genesys APIs");
        });
    }).catch(err => {
        console.error('Error fetching access token:', err);
        res.status(500).send("Something went wrong when fetching access token");
    });
});

const get_id_name_pairs = async (req, res) => {
    const order = req.params.order ? req.params.order : "descending";
    const ids = req.params.ids ? req.params.ids : null;
    const state = req.params.state ? req.params.state : "any";
    
    let url = "https://api.mypurecloud.ie/api/v2/users"
    if(ids){
     url += `?id=${ids}&sortOrder=${order}&state=${state}`
    }
    else{
     url += `?sortOrder=${order}&state=${state}`
    }
    return await getAccessToken().then(async (token) => {
        await AXIOS({
            url: url,
            method: 'get',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        }).then(response => {
            const d = response.data.entities.reduce((acc, person) => {
                acc[person.id] = person.name;
                return acc;
            }, {});
            console.log(d);
            return d;
        }).catch(err => {
            return null;
        });
    });
}

APP.get('/management-units', async (req, res) => {
    try {
        const token = await getAccessToken();
        const response = await AXIOS({
            url: 'https://api.mypurecloud.ie/api/v2/workforcemanagement/managementunits',
            method: 'get',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        const managementUnits = response.data.entities.map(unit => ({
            id: unit.id,
            name: unit.name
        }));
        console.log('Management units fetched successfully:', managementUnits);
        res.status(200).send(managementUnits);
    } catch (error) {
        console.error('Error fetching management units:', error.response ? error.response.data : error.message);
        res.status(500).send("Something went wrong when fetching management units");
    }
});



// Existing server setup
var server = HTTP.createServer(APP);
server.listen(ENV.PORT || 3000, () => {
    console.log('Server is running');
});
