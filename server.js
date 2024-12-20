const express = require('express');
const path = require('path');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');


const app = express();
const port = 3535;




// Serve static files from the /client directory
app.use(express.static(path.join(__dirname, 'client')));

const server = app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

// We will use the socket.io library to manage Websocket connections
const io = require("socket.io")().listen(server);

let projectStatusSubscriptions = {};
let projectStatus = {};

const updateProjectSubscriptions = (fileName) => {
    if (!projectStatus[fileName])  return;
    if (projectStatusSubscriptions[fileName]) {
        for (let socket of projectStatusSubscriptions[fileName]) {
            socket.emit('statusUpdate', projectStatus[fileName]);
        }
    }
}
// Set up each socket connection
io.on("connection", (socket) => {
    console.log("New socket connected!");

    socket.on('subscribe', (data) => {
        console.log(`${socket.id} is subscribing to ${data.filePath}`);

        if (!projectStatusSubscriptions[data.filePath]) {
            projectStatusSubscriptions[data.filePath] = [];
        }
        projectStatusSubscriptions[data.filePath].push(socket);
        updateProjectSubscriptions(data.filePath);
    });

});



const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'uploads'));
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

app.post('/upload', upload.single('file'), (req, res) => {
    res.send('File uploaded successfully');
    console.log('File uploaded, starting to process data w/ nerfstudio');
    projectStatus[req.file.path] = "";
    projectStatus[req.file.path] += "File uploaded succesfully! Beginning ns-process-data...";
    processUploadedVideoFile(req.file.path);
});

function processUploadedVideoFile(filePath) {
    // make a directory under 'nerfstudio-output' to store data (using date.now() and file name as name)
    const outputDir = path.join(__dirname, 'nerfstudio-output', `${Date.now()}-${path.basename(filePath)}`);
    fs.mkdirSync(outputDir, { recursive: true });

    // Create 'processed' directory under the output directory
    const processedDir = path.join(outputDir, 'processed');
    fs.mkdirSync(processedDir, { recursive: true });

    // Create 'output' directory under the output directory
    const outputDirPath = path.join(outputDir, 'output');
    fs.mkdirSync(outputDirPath, { recursive: true });

    let nsProcessDataProcess = spawn('ns-process-data', ['video', '--data', filePath, '--output-dir', processedDir]);

    nsProcessDataProcess.stdout.on('data', (data) => {
        console.log(`ns-process-data stdout: ${data}`);
        projectStatus[path.basename(filePath)] += data.toString();
        updateProjectSubscriptions(path.basename(filePath));
    });

    nsProcessDataProcess.stderr.on('data', (data) => {
        console.error(`ns-process-data stderr: ${data}`);
        projectStatus[path.basename(filePath)] += data.toString();
        updateProjectSubscriptions(path.basename(filePath));
    });

    nsProcessDataProcess.on('close', (code) => {
        console.log(`ns-process-data process exited with code ${code}`);
        if (code === 0) {
            trainSplatfactoModel(filePath, processedDir, outputDirPath);
        } else {
            projectStatus[path.basename(filePath)] += `ns-process-data process exited with code ${code}`;
            updateProjectSubscriptions(path.basename(filePath));
        }
    });
}

function trainSplatfactoModel(filePath, processedDir, outputDirPath) {

    let nsTrainProcess = spawn('ns-train', ['splatfacto', '--data', processedDir, '--output-dir', outputDirPath]);

    nsTrainProcess.stdout.on('data', (data) => {
        console.log(`ns-train stdout: ${data}`);
        projectStatus[path.basename(filePath)] += data.toString();
        updateProjectSubscriptions(path.basename(filePath));
    });

    nsTrainProcess.stderr.on('data', (data) => {
        console.error(`ns-train stderr: ${data}`);
        projectStatus[path.basename(filePath)] += data.toString();
        updateProjectSubscriptions(path.basename(filePath));
    });

    nsTrainProcess.on('close', (code) => {
        console.log(`ns-train process exited with code ${code}`);
        if (code !== 0) {
            projectStatus[path.basename(filePath)] += `ns-train process exited with code ${code}`;
        }
        updateProjectSubscriptions(path.basename(filePath));
    });
}

