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

app.get("/", async (req,res) => {
    const types = await knex.select('typename').from('type');
    res.render("index", {types});
});

app.get("/showLogin", (req, res) => res.render("login"));

// route to check authentication for login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // Query the user table to find the record
        const credentials = await knex('usercredentials')
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

app.listen(port, () => console.log("Express App has started listening."));