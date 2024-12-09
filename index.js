let express = require("express");

let app = express();

let path = require("path");

const port = process.env.PORT || 5000;

// authentication
const session = require("express-session");

app.use(
    session({
        secret : "my_secret_key", //replace with a secure, random key
        resave : false,
        saveUninitialized : false,
        cookie : {secure : false, maxAge : 3600000}, // session expires in 1 hour (adjust as needed)
    })
);

app.set("view engine", "ejs");

app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({extended: true}));

app.use(express.static("public"));

const knex = require("knex") ({
    client : "pg",
    connection : {
        host : process.env.RDS_HOSTNAME || "localhost",
        user : process.env.RDS_USERNAME || "postgres",
        password : process.env.RDS_PASSWORD || "admin",
        database : process.env.RDS_DB_NAME || "minervascleaningservice",
        port : process.env.RDS_PORT || 5432,
        ssl : process.env.DB_SSL ? {rejectUnauthorized: false} : false
    }
});

// Authentication Middleware
function isAuthenticated(req, res, next) {
    if (!req.session.isAuthenticated) {
        return res.redirect('/login'); // Redirect unauthenticated user to the login page
    }
    next(); // Allow access to the next middleware or route handler
}

// function to make displayed data as proper case
function toProperCase(str) {
    if (!str) return ''; // Handle null or undefined
    return str.replace(/\w\S*/g, word =>
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    );
}

// ** Public Routes **
// go to landing
app.get("/", async (req,res) => {
    const types = await knex.select('typename').from('type');
    res.render("index", {types});
});

// go to login
app.get("/login", (req, res) => res.render("login"));

// route to check authentication for login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // Query the user table to find the record
        const credentials = await knex('credentials')
            .select('*')
            .where({ username, password }) // replace with hashed password comparison in production
            .first();
        if (!credentials) {
            // User not found
            req.session.isAuthenticated = false;
            return res.status(401).render('login', { error: 'Invalid username or password.'});
        }
        // Verify the password
        if (credentials.password !== password) {
            req.session.isAuthenticated = false; // set session authentication flag
            res.status(401).render('login', { error: 'Invalid username or password.'})
        }
        
        // Successful login
        req.session.isAuthenticated = true;
        res.redirect('adminlanding')
    }
    catch (error) {
        console.error('Error during login:', error);
        res.status(500).send('Internal Server Error');
    } 
});

// route to logout and go home
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error during logout:', err);
            return res.status(500).send('Could not log out. Try again.');
        }
        res.redirect('/');
    });
});

// Show the form to signup as new client
app.get('/signupclient', (req, res) => {
    res.render('signupclient'); // Create an `addclient.ejs` template
});

// Submit new client
app.post('/signupclient', async (req, res) => {
    const {
        clientfirst,
        clientlast,
        clientstreetaddress,
        clientcity,
        clientstate,
        clientzipcode,
        clientphone,
        clientemail
    } = req.body;

    try {
        await knex('client').insert({
            clientfirst,
            clientlast,
            clientstreetaddress,
            clientcity,
            clientstate,
            clientzipcode,
            clientphone,
            clientemail
        });

        res.redirect('/'); // Redirect to the client list page after adding
    } catch (error) {
        console.error('Error submitting client:', error);
        res.status(500).send('Internal Server Error');
    }
});

// ** Authenticated Routes **
// Go to admin landing page
app.get('/adminlanding', isAuthenticated, (req, res) => {
    res.render('adminlanding', { user: req.session.user }); // Authenticated landing page
});

// Go to client page
app.get('/clientinfo', isAuthenticated, async (req, res) => {
    try {
        const clients = await knex('client')
            .join('orders', 'client.clientid', '=', 'orders.clientid')
            .join('recurringschedule', 'orders.recurringid', '=', 'recurringschedule.recurringid')
            .join('services', 'orders.serviceid', '=', 'services.serviceid')
            .join('type', 'services.typeid', '=', 'type.typeid')
            .join('building', 'services.buildingid', '=', 'building.buildingid')
            .select(
                'client.clientid',
                'clientfirst',
                'clientlast',
                'transactiondate',
                'frequency',
                'buildingtype',
                'typename',
                'price',
                'status'
            );

        if (!clients || clients.length === 0) {
            return res.status(404).send('No clients found');
        }

        // Convert all client strings to proper case
        clients.forEach(client => {
            Object.keys(client).forEach(key => {
                if (typeof client[key] === 'string') {
                    client[key] = toProperCase(client[key]);
                }
            });
        });

        res.render('clientinfo', { clients }); // Pass the entire array
    } catch (error) {
        console.error('Error querying database:', error);
        res.status(500).send('Internal Server Error');
    }
});

// go to client details for specific client
app.get('/clientdetails/:clientid', isAuthenticated, async (req, res) => {
    const { clientid } = req.params;

    try {
        // Get all details for the specific client
        const client = await knex('client')
            .join('orders', 'client.clientid', '=', 'orders.clientid')
            .join('recurringschedule', 'orders.recurringid', '=', 'recurringschedule.recurringid')
            .join('services', 'orders.serviceid', '=', 'services.serviceid')
            .join('type', 'services.typeid', '=', 'type.typeid')
            .join('building', 'services.buildingid', '=', 'building.buildingid')
            .where('client.clientid', clientid)
            .select(
                'clientfirst',
                'clientlast',
                'clientstreetaddress',
                'clientcity',
                'clientstate',
                'clientzipcode',
                'clientphone',
                'clientemail',
                'transactiondate',
                'frequency',
                'buildingtype',
                'typename',
                'price',
                'status'
            )
            .first();

        if (!client) {
            return res.status(404).send('Client not found');
        }

        // Convert all string fields to proper case
        Object.keys(client).forEach(key => {
            if (typeof client[key] === 'string' && key !== 'clientemail' && key !== 'clientstate') {
                client[key] = toProperCase(client[key]);
            }
        });

        res.render('clientdetails', { client });
    } catch (error) {
        console.error('Error querying database:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Delete a client by ID from client details page
app.post('/clientdetails/delete/:clientid', isAuthenticated, async (req, res) => {
    const { clientid } = req.params;

    try {
        const deletedCount = await knex('client')
            .where('clientid', clientid)
            .del();

        if (deletedCount === 0) {
            return res.status(404).send('Client not found');
        }

        res.redirect('/clients'); // Redirect to the client list after deletion
    } catch (error) {
        console.error('Error deleting client:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Show the form to add a new client
app.get('/clients/add', isAuthenticated, (req, res) => {
    res.render('addclient'); // Create an `addclient.ejs` template
});

// Add a new client
app.post('/clients/add', isAuthenticated, async (req, res) => {
    const {
        clientfirst,
        clientlast,
        clientstreetaddress,
        clientcity,
        clientstate,
        clientzipcode,
        clientphone,
        clientemail
    } = req.body;

    try {
        await knex('client').insert({
            clientfirst,
            clientlast,
            clientstreetaddress,
            clientcity,
            clientstate,
            clientzipcode,
            clientphone,
            clientemail
        });

        res.redirect('/clients'); // Redirect to the client list page after adding
    } catch (error) {
        console.error('Error adding client:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Show the form to edit a client
app.get('/clients/edit/:clientid', isAuthenticated, async (req, res) => {
    const { clientid } = req.params;

    try {
        const client = await knex('client')
            .where('clientid', clientid)
            .first();

        if (!client) {
            return res.status(404).send('Client not found');
        }

        res.render('editclient', { client }); // Create an `editclient.ejs` template
    } catch (error) {
        console.error('Error fetching client:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Update a client's information
app.post('/clients/edit/:clientid', isAuthenticated, async (req, res) => {
    const { clientid } = req.params;
    const {
        clientfirst,
        clientlast,
        clientstreetaddress,
        clientcity,
        clientstate,
        clientzipcode,
        clientphone,
        clientemail
    } = req.body;

    try {
        const updatedCount = await knex('client')
            .where('clientid', clientid)
            .update({
                clientfirst,
                clientlast,
                clientstreetaddress,
                clientcity,
                clientstate,
                clientzipcode,
                clientphone,
                clientemail
            });

        if (updatedCount === 0) {
            return res.status(404).send('Client not found');
        }

        res.redirect('/clients'); // Redirect to the client list page after editing
    } catch (error) {
        console.error('Error updating client:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Go to calender

// go to user info


app.listen(port, () => console.log("Express App has started listening."));