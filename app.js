const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const nunjucks = require('nunjucks');
const console = require('better-console');

nunjucks.configure('views', {
    autoescape: true,
    express: app
});

const config = {
    'statusTypes': {
        'not_done': { 'verboseName': 'Pracuju' },
        'help': { 'verboseName': 'Chci poradit' },
        'done': { 'verboseName': 'Hotovo' },
    },
    'deskTypes': {
        0: { 'chairs': 4, 'shape': 'square' },
        1: { 'chairs': 2, 'shape': 'square' },
    },
    'roomSize': 2
};

let classStatus = 'appstarted'; // others: 'lecturing' and 'working'

let desks = {
    0: { 'name': '', 'coach': 'Kamila', 'layout': { 'position': { 'x': 0, 'y': 0 }, 'rotation': 0, 'deskType': 0 } },
    1: { 'name': '', 'coach': 'Karel', 'layout': { 'position': { 'x': 1, 'y': 1 }, 'rotation': 0, 'deskType': 1 } },
    2: { 'name': '', 'coach': 'Klára', 'layout': { 'position': { 'x': 0, 'y': 1 }, 'rotation': 0, 'deskType': 1 } },
};

for (let d in desks){

    // initial desk status
    desks[d].status = 'empty';

    // add layout
    Object.assign(desks[d].layout, config.deskTypes[desks[d].layout.deskType]);

    // add empty chairs
    desks[d].chairs = {};
    for (let c = 0; c < desks[d].layout.chairs; c++){
        desks[d].chairs[c] = { status: '' };
    }

    // compute values for positioning in layout
    desks[d].layout.position.x = desks[d].layout.position.x * 100 / config.roomSize;
    desks[d].layout.position.y = desks[d].layout.position.y * 100 / config.roomSize;
    desks[d].layout.dimensions = {};
    desks[d].layout.dimensions.x = 100 / config.roomSize;
    desks[d].layout.dimensions.y = 100 / config.roomSize;
}

function checkDeskStatus(deskId){
    // make an array of chair statuses (easier to work with)
    let i = 0, chairStatuses = [];
    for (let chair in desks[deskId].chairs){
        if (desks[deskId].chairs[chair].socketId){
            chairStatuses[i++] = desks[deskId].chairs[chair].status; // fill chairStatuses only with non-empty values
        }
    }

    let originalDeskStatus = desks[deskId].status; // save original status

    if (chairStatuses.length){ // not empty table

        if (chairStatuses.some(x => x == 'not_done')){ // some working
            desks[deskId].status = 'not_done';
        }

        if (chairStatuses.some(x => x == 'help')){ // some need help
            desks[deskId].status = 'help';
        }

        if (chairStatuses.every(x => x == 'done')){ // all done
            desks[deskId].status = 'done';
        }

        if (chairStatuses.every(x => x == '')){ // all no status
            desks[deskId].status = 'init';
        }

    } else {
        desks[deskId].status = 'empty'; // empty table
    }

    if (originalDeskStatus != desks[deskId].status){ // if the status has changed
        io.emit('deskStatusChanged', deskId, desks[deskId].status); // emit new status
        console.info('>D> deskStatusChanged', 'desk', deskId, desks[deskId].status);
    }
}

app
    .set('port', (process.env.PORT || 3000))

    .use(express.static(__dirname + '/static'))

    .get('/', (req, res) =>{
        res.render('index.njk', {
            desks: desks,
            statusTypes: config.statusTypes
        });
    })

    .get('/desk/:deskId/chair/:chairId/', (req, res) =>{
        res.render('chair.njk', {
            desk: desks[req.params.deskId],
            chair: desks[req.params.deskId].chairs[req.params.chairId],
            classStatus: classStatus,
            statusTypes: config.statusTypes
        });
    })

    .get('/teacher', (req, res) =>{
        res.render('teacher.njk', {
            desks: desks,
            statusTypes: config.statusTypes,
            classStatus: classStatus
        });
    })
;

io
    .set('origins', '*:*')

    .on('connection', socket =>{
        socket
            .on('auth-request', (deskId, chairId) =>{
                if (desks[deskId].chairs[chairId]){ // is this a existing chair?
                    desks[deskId].chairs[chairId].socketId = socket.id; // save socket.id to a chair
                    io.emit('auth-success', deskId, chairId);
                    io.emit('statusChanged', deskId, chairId, '');
                    console.info('+++ auth-success', deskId, chairId, desks[deskId].chairs[chairId].name);
                    checkDeskStatus(deskId);
                }
            })

            // on disconnection find which chair disconnected and clear it's properties
            .on('disconnect', () =>{
                for (let d in desks){
                    for (let c in desks[d].chairs){
                        if (desks[d].chairs[c].socketId == socket.id){
                            desks[d].chairs[c].status = '';
                            delete desks[d].chairs[c].socketId;
                            io.emit('statusChanged', d, c, '');
                            io.emit('disconnected', d, c);
                            console.info('--- disconnected', d, c);
                            checkDeskStatus(d);
                        }
                    }
                }
            })

            .on('setStudentName', (deskId, chairId, studentName) =>{
                desks[deskId].chairs[chairId].name = studentName;
                io.emit('studentNameSet', deskId, chairId, studentName); // emit new name
                console.info('\\\ setStudentName', deskId, chairId, studentName);
            })

            .on('statusChange', (deskId, chairId, statusType) =>{
                desks[deskId].chairs[chairId].status = statusType; // save status
                io.emit('statusChanged', deskId, chairId, statusType); // emit new status
                console.info('>>> statusChanged', desks[deskId].chairs[chairId].name, statusType);
                checkDeskStatus(deskId);
            })

            .on('checkStatus', () =>{
                for (let d in desks){
                    for (let c in desks[d].chairs){
                        if (desks[d].chairs[c].socketId && desks[d].chairs[c].status != 'done'){
                            io.to(desks[d].chairs[c].socketId).emit('checkStatusAlert');
                            console.info('??? checkStatus', desks[d].chairs[c].name, desks[d].chairs[c].status);
                        }
                    }
                }
            })

            .on('lectureStart', () =>{
                for (let d in desks){
                    for (let c in desks[d].chairs){
                        desks[d].chairs[c].status = '';
                        io.emit('statusChanged', d, c, desks[d].chairs[c].status);
                        console.info('!!! lectureStart', desks[d].chairs[c]);
                    }
                    checkDeskStatus(d);
                }
                classStatus = 'lecturing';
                io.emit('lectureStarted', classStatus);
            })

            .on('workStart', () =>{
                for (let d in desks){
                    for (let c in desks[d].chairs){
                        if (desks[d].chairs[c].socketId){
                            desks[d].chairs[c].status = 'not_done';
                        } else {
                            desks[d].chairs[c].status = '';
                        }
                        io.emit('statusChanged', d, c, desks[d].chairs[c].status);
                        console.info('/// workStart', desks[d].chairs[c], desks[d].chairs[c].status);
                    }
                    checkDeskStatus(d);
                }
                classStatus = 'working';
                io.emit('workStarted', classStatus);
            });
    })
;

server.listen(app.get('port'));