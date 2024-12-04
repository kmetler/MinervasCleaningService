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

app.get("/", async (req,res) => {
    const types = await knex.select('typename').from('type');
    res.render("index", {types});
});

app.get("/showLogin", (req, res) => res.render("login"));

app.post("/login", async (req, res) => {
    const { username, password } = req.body

    try {
        const credentials = await knex('credentials')
            .select('*')
            .where({ username, password }) //Replace with hashedpassword comparison in prodection
            .first();
        if (credentials) {
            req.session.isAuthenticated = true; // set session authentication flag
        } else {
            req.session.isAuthenticated = false; // clear authenticaion flag
        }
    } catch (error) {
        console.error("Error during login:", error);
        res.status(500).send("Database query failed:" + error.message);
    }
    res.render("clientpage");
});

app.listen(port, () => console.log("Express App has started listening."));