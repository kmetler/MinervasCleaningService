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
app.get('/signupclient', async (req, res) => {
    try {
        // Fetch building types and service types from the database
        const buildingTypes = await knex('building').select('buildingid', 'buildingtype');
        const serviceTypes = await knex('type').select('typeid', 'typename', 'typedescription');

        // Render the form with the fetched data
        res.render('signupclient', { buildingTypes, serviceTypes });
    } catch (error) {
        console.error('Error fetching dropdown data:', error);
        res.status(500).send('Internal Server Error');
    }
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
        clientemail,
        buildingtype,
        servicetype
    } = req.body;

    try {
        await knex('client').insert({
            clientfirst: clientfirst.toUpperCase(),
            clientlast: clientlast.toUpperCase(),
            clientstreetaddress: clientstreetaddress.toUpperCase(),
            clientcity: clientcity.toUpperCase(),
            clientstate: clientstate.toUpperCase(),
            clientzipcode,
            clientphone,
            clientemail,
            status: 'P', // make the client pending automatically
            buildingid: buildingtype,
            serviceid: servicetype
        });

        res.redirect('/'); // Redirect to the client list page after adding
    } catch (error) {
        console.error('Error submitting client:', error);
        res.status(500).send('Internal Server Error');
    }
});

// route to dynamically display price on sign up
app.get('/getprice', async (req, res) => {
    const { buildingid, serviceid } = req.query;

    try {
        // Fetch price for the selected building and service type
        const service = await knex('services')
            .join('building', 'services.buildingid', '=', 'building.buildingid')
            .select('price')
            .where('services.serviceid', serviceid)
            .andWhere('building.buildingid', buildingid)
            .first();

        if (service) {
            return res.json({ success: true, price: service.price });
        } else {
            return res.json({ success: false, message: 'Price not found' });
        }
    } catch (error) {
        console.error('Error fetching price:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
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
            .leftJoin('orders', 'client.clientid', '=', 'orders.clientid')
            .join('services', 'client.serviceid', '=', 'services.serviceid')
            .join('type', 'services.typeid', '=', 'type.typeid')
            .join('building', 'services.buildingid', '=', 'building.buildingid')
            .select(
                'client.clientid',
                'clientfirst',
                'clientlast',
                'clientstreetaddress',
                'clientcity',
                'clientstate',
                'clientzipcode',
                'clientphone',
                'clientemail',
                'status',
                'buildingtype',
                'typename',
                'price',
            )
            .orderBy('status', 'desc') // Order by status descending
            .orderBy('clientlast', 'asc') // Then by last name ascending
            .orderBy('clientfirst', 'asc'); // Finally by first name ascending

        if (!clients || clients.length === 0) {
            return res.status(404).send('No clients found');
        }

        // Convert all client strings to proper case
        clients.forEach(client => {
            Object.keys(client).forEach(key => {
                if (typeof client[key] === 'string' && key !== 'clientemail') {
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

// go to client details for specific client and order details
app.get('/clientdetails/:clientid', isAuthenticated, async (req, res) => {
    const { clientid } = req.params;

    try {
        // Fetch client information along with service and building details
        const client = await knex('client')
            .join('services', 'client.serviceid', '=', 'services.serviceid')
            .join('type', 'services.typeid', '=', 'type.typeid')
            .join('building', 'services.buildingid', '=', 'building.buildingid')
            .select(
                'client.clientid',
                'clientfirst',
                'clientlast',
                'clientstreetaddress',
                'clientcity',
                'clientstate',
                'clientzipcode',
                'clientphone',
                'clientemail',
                'status',
                'buildingtype',
                'typename',
                'typedescription',
                'price'
            )
            .where('client.clientid', clientid)
            .first();

        if (!client) {
            return res.status(404).send('Client not found');
        }

        // Fetch all orders related to the client, ordered by the most recent date
        const orders = await knex('orders')
            .where('clientid', clientid)
            .select('transactionid', 'transactiondate', 'paid')
            .orderBy('transactiondate', 'desc');

        // Convert string fields to proper case
        Object.keys(client).forEach((key) => {
            if (typeof client[key] === 'string' && key !== 'clientemail' && key !== 'clientstate') {
                client[key] = toProperCase(client[key]);
            }
        });

        res.render('clientdetails', { client, orders });
    } catch (error) {
        console.error('Error querying database:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Show the form to add a new client
app.get('/clients/add', isAuthenticated, async (req, res) => {
    try {
        // Fetch building types and service types from the database
        const buildingTypes = await knex('building').select('buildingid', 'buildingtype');
        const serviceTypes = await knex('type').select('typeid', 'typename', 'typedescription');

        // Render the form with the fetched data
        res.render('addclient', { buildingTypes, serviceTypes });
    } catch (error) {
        console.error('Error fetching dropdown data:', error);
        res.status(500).send('Internal Server Error');
    }
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
        clientemail,
        buildingtype,
        servicetype
    } = req.body;

    try {
        await knex('client').insert({
            clientfirst: clientfirst.toUpperCase(),
            clientlast: clientlast.toUpperCase(),
            clientstreetaddress: clientstreetaddress.toUpperCase(),
            clientcity: clientcity.toUpperCase(),
            clientstate: clientstate.toUpperCase(),
            clientzipcode,
            clientphone,
            clientemail,
            buildingid: buildingtype,
            serviceid: servicetype
        });

        res.redirect('/clients'); // Redirect to the client list page after adding
    } catch (error) {
        console.error('Error adding client:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Show the form to edit a client
app.get('/editclient/:clientid', isAuthenticated, async (req, res) => {
    const { clientid } = req.params;

    try {
        const client = await knex('client')
            .join('services', 'client.serviceid', '=', 'services.serviceid')
            .join('type', 'services.typeid', '=', 'type.typeid')
            .join('building', 'services.buildingid', '=', 'building.buildingid')
            .select(
                'client.clientid',
                'clientfirst',
                'clientlast',
                'clientstreetaddress',
                'clientcity',
                'clientstate',
                'clientzipcode',
                'clientphone',
                'clientemail',
                'status',
                'buildingtype',
                'typename'
            )
            .where('client.clientid', clientid)
            .first();

        const services = await knex('type').select('typename');
        const buildings = await knex('building').select('buildingtype');

        if (!client) {
            return res.status(404).send('Client not found');
        }

        res.render('editclient', { client, services, buildings });
    } catch (error) {
        console.error('Error fetching client data:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Update a client's information
app.post('/updateclient/:clientid', isAuthenticated, async (req, res) => {
    const { clientid } = req.params;
    const { clientfirst, clientlast, status, typename, buildingtype } = req.body;

    try {
        // Find the matching service ID based on typename and buildingtype
        const service = await knex('services')
            .join('type', 'services.typeid', '=', 'type.typeid')
            .join('building', 'services.buildingid', '=', 'building.buildingid')
            .where({ typename, buildingtype })
            .select('serviceid')
            .first();

        if (!service) {
            return res.status(400).send('Invalid service or building type');
        }

        // Update client information
        await knex('client')
            .where('clientid', clientid)
            .update({
                clientfirst: clientfirst.toUpperCase(),
                clientlast: clientlast.toUpperCase(),
                status,
                serviceid: service.serviceid,
            });

        res.redirect(`/clientdetails/${clientid}`);
    } catch (error) {
        console.error('Error updating client:', error);
        res.status(500).send('Internal Server Error');
    }
});

// go to add an order to a client
app.get('/addorder/:clientid', isAuthenticated, async (req, res) => {
    const { clientid } = req.params;

    try {
        res.render('addorder', { clientid });
    } catch (error) {
        console.error('Error displaying add order page:', error);
        res.status(500).send('Internal Server Error');
    }
});

// delete a client along with connecting orders
app.get('/deleteclient/:clientid', isAuthenticated, async (req, res) => {
    const { clientid } = req.params;

    try {
        await knex.transaction(async trx => {
            await trx('orders').where('clientid', clientid).del();
            await trx('client').where('clientid', clientid).del();
        });

        res.redirect('/adminlanding');
    } catch (error) {
        console.error('Error deleting client and orders:', error);
        res.status(500).send('Internal Server Error');
    }
});

// delete an individual order
app.get('/deleteorder/:orderid', isAuthenticated, async (req, res) => {
    const { orderid } = req.params;

    try {
        await knex('orders').where('orderid', orderid).del();
        res.redirect('back');
    } catch (error) {
        console.error('Error deleting order:', error);
        res.status(500).send('Internal Server Error');
    }
});

// go to edit order page
app.get('/editorder/:orderid', isAuthenticated, async (req, res) => {
    const { orderid } = req.params;

    try {
        const order = await knex('orders')
            .join('client', 'orders.clientid', '=', 'client.clientid')
            .select('orders.*', 'client.clientid')
            .where('orderid', orderid)
            .first();

        if (!order) {
            return res.status(404).send('Order not found');
        }

        res.render('editorder', { order });
    } catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).send('Internal Server Error');
    }
});

// finish updating the order
app.post('/updateorder/:orderid', isAuthenticated, async (req, res) => {
    const { orderid } = req.params;
    const { transactiondate, paid } = req.body;

    try {
        await knex('orders')
            .where('orderid', orderid)
            .update({
                transactiondate: new Date(transactiondate),
                paid: paid === 'true',
            });

        res.redirect(`/clientdetails/${req.body.clientid}`);
    } catch (error) {
        console.error('Error updating order:', error);
        res.status(500).send('Internal Server Error');
    }
});

// go to user info
app.get('/userinfo', isAuthenticated, async (req, res) => {
    try {
        const users = await knex('usercredentials')
            .select(
                'userid',
                'userfirstname',
                'userlastname',
                'userphone',
                'useremail',
                'username',
                'password'
            );

        // Apply toProperCase to relevant string fields
        const formattedUsers = users.map(user => ({
            userid: user.userid, // Keep numeric fields as they are
            userfirstname: toProperCase(user.userfirstname),
            userlastname: toProperCase(user.userlastname),
            userphone: user.userphone, // Leave non-string fields untouched
            useremail: user.useremail,
            username: user.username,
            password: user.password // Normally passwords wouldn't be displayed
        }));

        res.render('usercredentials', { users: formattedUsers });
    }
    catch (error) {
        console.error('Error retrieving user credentials:', error);
        res.status(500).send('Internal Server Error');
    }
});

// edit user information
app.get('/edituser/:userid', isAuthenticated, async (req, res) => {
    const userid = req.params.userid;

    try {
        const user = await knex('usercredentials')
            .where({ userid: userid})
            .first();
            
        if (!user) {
            return res.status(404).send('User not found');
        }

        // Apply toProperCase to relevant string fields
        const formattedUser = {
            userid: user.userid, // Keep numeric fields unchanged
            userfirstname: toProperCase(user.userfirstname),
            userlastname: toProperCase(user.userlastname),
            userphone: user.userphone, // Phone numbers are not transformed
            useremail: user.useremail,
            username: user.username, // Optionally format usernames if needed
            password: user.password // Password handling; typically not displayed directly
        };
        
        res.render('edituser', { user: formattedUser });
    } catch (error) {
        console.error('Error retreiving user:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/edituser/:userid', isAuthenticated, async (req, res) => {
    const userid = req.params.userid;

    const { userfirstname, userlastname, userphone, useremail, username, password } = req.body;

    try {
        await knex('usercredentials')
            .where('userid', userid)
            .update({
                userfirstname: userfirstname.toUpperCase(),
                userlastname: userlastname.toUpperCase(),
                userphone: userphone,
                useremail: useremail,
                username: username,
                password: password,
            });
        
        res.redirect('/usercredentials');
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).send('Internal Server Error');
    }
});

// delete user
app.post('/deleteuser/:userid', isAuthenticated, async (req, res) => {
    const userid = req.params.userid;
  
    try {
        const user = await knex('usercredentials')
            .where('userid', userid)
            .del();

            res.redirect('/usercredentials');
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).send('Internal Server Error');
    }
});

// go to add user page
app.get('/addUser', isAuthenticated, (req, res) => {
    res.render('addUser');
})

// save added user
app.post('/addUser', isAuthenticated, async (req, res) => {
    const userfirstname = req.body.userfirstname || '';
    const userlastname = req.body.userlastname || '';
    const userphone = req.body.userphone || '';
    const useremail = req.body.useremail || '';
    const username = req.body.username || '';
    const password = req.body.password || '';

    try {
        await knex('usercredentials')
        .insert({
            userfirstname: userfirstname.toUpperCase(),
            userlastname: userlastname.toUpperCase(),
            userphone: userphone,
            useremail: useremail,
            username: username,
            password: password,
        });
        res.redirect('/usercredentials');
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).send('Internal Server Error');
    }
})

app.listen(port, () => console.log("Express App has started listening."));