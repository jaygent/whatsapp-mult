const qrcode = require("qrcode");
const fs = require("fs");
const express = require("express");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const bp=require('body-parser');
const  md5 = require('md5');


const app=express();
app.use(bp.json())
app.use(bp.urlencoded({ extended: true }))
app.use(function (req, res, next) {
    const hash='21232f297a57a5a743894a0e4a801fc3';
    const token=req.query.token
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.hash == token);
    if(token==hash){
       next();
    }else if(savedSessions[sessionIndex].hash===token){
        next();
    }else{
        res.status(403).json({message:false})
    }
});
const sessions = [];
const SESSIONS_FILE = './whatsapp-sessions.json';

const createSessionsFileIfNotExists = function() {
    if (!fs.existsSync(SESSIONS_FILE)) {
        try {
            fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
            console.log('Sessions file created successfully.');
        } catch(err) {
            console.log('Failed to create sessions file: ', err);
        }
    }
}

createSessionsFileIfNotExists();

 function makeid(length) {
    var result           = '';
    var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
        result += characters.charAt(Math.floor(Math.random() *
            charactersLength));
    }
    return result;
}

const setSessionsFile = function(sessions) {
    fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function(err) {
        if (err) {
            console.log(err);
        }
    });
}

const getSessionsFile = function() {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}

const createSession = function(id,hash) {
    console.log('Creating session: ' + id);
    const client = new Client({
        restartOnAuthFail: true,
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process', // <- this one doesn't works in Windows
                '--disable-gpu'
            ],
        },
        authStrategy: new LocalAuth({
            clientId: id, dataPath:'webjs_auth'
        })
    });

    client.initialize();

    client.on('qr', (qr) => {
        console.log('QR RECEIVED', qr);
        qrcode.toDataURL(qr, (err, url) => {
            const savedSessions = getSessionsFile();
            const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
            savedSessions[sessionIndex].qr = url;
            setSessionsFile(savedSessions);
            console.log('message '+ id+ 'QR Code received, scan please!');
        });
    });

    client.on('ready', () => {
       console.log('ready', { id: id });
        console.log('message '+id+' Whatsapp is ready!');

        const savedSessions = getSessionsFile();
        const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
        savedSessions[sessionIndex].ready = true;
        setSessionsFile(savedSessions);
    });

    client.on('authenticated', () => {
        console.log('authenticated', { id: id });
        const savedSessions = getSessionsFile();
        const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
        savedSessions[sessionIndex].auth = true;
        setSessionsFile(savedSessions);
    });

    client.on('auth_failure', function() {
        console.log('message', { id: id, text: 'Auth failure, restarting...' });
    });

    client.on('change_state', function(ms) {
        console.log('message', {ms});
    });

    client.on('disconnected', (reason) => {
        console.log('message', { id: id, text: 'Whatsapp is disconnected!' });
        client.destroy();
        if(fs.existsSync('webjs_auth/session-'+id)){
            fs.rmSync('webjs_auth/session-'+id,{ recursive: true, force: true });
            client.initialize();
            const savedSessions = getSessionsFile();
            const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
            savedSessions[sessionIndex].auth = false;
            setSessionsFile(savedSessions);
        }
    });

    // adding sessions
    sessions.push({
        id: id,
        auth:false,
        hash:hash,
        client: client
    });

    // adding session in file
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

    if (sessionIndex == -1) {
        savedSessions.push({
            id: id,
            auth:false,
            ready: false,
            hash:hash,
        });
        setSessionsFile(savedSessions);
    }
}


const init = function(socket) {
    const savedSessions = getSessionsFile();

    if (savedSessions.length > 0) {

        savedSessions.forEach(sess => {
            createSession(sess.id);
        });
    }
}

init();


app.get('/start/:id',(req,res)=>{
    console.log('Create session: ' + req.params.id);
    let hash=md5(makeid(10));
    createSession(req.params.id,hash);
    res.json({
        token: hash,
        message: "Create instant"+req.params.id,
    });
})


app.get('/qr/:id',(req,res)=>{
        const id=req.params.id;
        const savedSessions = getSessionsFile();
        const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
        if(savedSessions[sessionIndex].auth){
            res.send("authendication");
        }else{res.send('<img src="'+savedSessions[sessionIndex].qr+'"/>');}
    }
)
app.get('/info/:id',(req,res)=>{
        const sender=req.params.id;
        const client = sessions.find(sess => sess.id == sender)?.client;
        res.json(client.info);
    }
)
app.get('/status/:id',(req,res)=>{
        const sender=req.params.id;
        const client = sessions.find(sess => sess.id == sender)?.client;
        client.getState().then(c=>res.json(c)).catch(err=>console.log(err))
    }
)
app.post('/isphone/:id',(req,res)=>{
        const sender=req.params.id;
        const client = sessions.find(sess => sess.id == sender)?.client;
        const number=req.body.number;
        client.isRegisteredUser(number).then(c=>res.json(c)).catch(err=>console.log(err))
    }
)
app.get('/reset/:id',(req,res)=>{
        const sender=req.params.id;
        const client = sessions.find(sess => sess.id == sender)?.client;
        client.destroy();
        client.initialize();
        res.json('ok');
    }
)
app.get('/logout/:id',(req,res)=>{
        const sender=req.params.id;
        const client = sessions.find(sess => sess.id == sender)?.client;
        client.logout();
        res.json('ok');
    }
)
app.get('/getchat/:id',(req,res)=>{
        const  sender=req.params.id;
        const client = sessions.find(sess => sess.id == sender)?.client;
        client.getChats().then(s=>{
            res.json(s);
        });

    }
)
app.get('/delete/:id',(req,res)=>{
    const id = req.params.id
    const client = sessions.find(sess => sess.id == id)?.client;
    client.logout();
    client.destroy();
    if(fs.existsSync('webjs_auth/session-'+id)){
        fs.rmSync('webjs_auth/session-'+id,{ recursive: true, force: true });
        const savedSessions = getSessionsFile();
        const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
        savedSessions.splice(sessionIndex, 1);
        setSessionsFile(savedSessions);
        res.json({'message':"ok"})
    }
})

app.post('/sendMessage/:id',(req,res)=>{
    const id = req.params.id
    const number = req.body.number;
    const message = req.body.message;

    const client = sessions.find(sess => sess.id == id)?.client;

    const isRegisteredNumber =  client.isRegisteredUser(number);

    if (!isRegisteredNumber) {
        return res.status(422).json({
            status: false,
            message: 'The number is not registered'
        });
    }
    client.getNumberId(number).then(c=>{
        client.sendMessage(c._serialized, message).then(response => {
            res.status(200).json({
                status: true,
                response: response._data.id.id
            });
        }).catch(err => {
            res.status(500).json({
                status: false,
                response: err
            });
        });
    })

})

app.listen(3000,()=>{
    console.log('App running on 3000');
});