let express = require("express");

let app = express();

let path = require("path");

const port = 5000;

app.set("view engine", "ejs");

app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({extended: true}));

app.use(express.static("public"));

const knex = require("knex") ({
    client : "pg",
    connection : {
        host : "localhost",
        user : "postgres",
        password : "admin",
        database : "minervascleaningservice",
        port : 5432
    }
});

app.get("/", async (req,res) => {
    const types = await knex.select('typename').from('type');
    res.render("index", {types});
});

app.get("/showLogin", (req, res) => res.render("login"));

app.post("/login", (req, res) => res.render("clientpage"));

app.listen(port, () => console.log("Express App has started listening."));