const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');

const PORT = 3000;
const DIR = __dirname;

// --- Auto-Extraction Logic for infoData ---
const dictPath = path.join(DIR, 'dictionary.html');
const infoPath = path.join(DIR, 'info_data.js');

if (!fs.existsSync(infoPath) && fs.existsSync(dictPath)) {
    let html = fs.readFileSync(dictPath, 'utf8');
    const startStr = '    const infoData = {';
    const endStr = '    function showModal(key) {';
    let sIdx = html.indexOf(startStr);
    let eIdx = html.indexOf(endStr);
    if (sIdx !== -1 && eIdx !== -1) {
        let block = html.substring(sIdx, eIdx);
        block = block.replace('const infoData =', 'let infoData =');
        fs.writeFileSync(infoPath, block, 'utf8');
        
        let newHtml = html.substring(0, sIdx) + html.substring(eIdx);
        newHtml = newHtml.replace('<script>', '<script src="info_data.js"></script>\n<script>');
        fs.writeFileSync(dictPath, newHtml, 'utf8');
        console.log("===========================================");
        console.log("[Setup] Successfully extracted infoData to info_data.js!");
    }
}
// ------------------------------------------

const server = http.createServer((req, res) => {
    // Enable CORS for API requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST, GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/update-info') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { key, newTitle, newBody } = data;
                
                let content = fs.readFileSync(infoPath, 'utf8');
                
                // Convert 'let' to 'var' so it attaches to the sandbox context
                let scriptContent = content.replace(/let\s+infoData\s*=/, 'var infoData =');
                let sandboxObj = {};
                vm.runInNewContext(scriptContent, sandboxObj);
                let obj = sandboxObj.infoData;
                
                if (obj && obj[key]) {
                    obj[key].title = newTitle;
                    obj[key].body = newBody;
                    let newContent = 'let infoData = ' + JSON.stringify(obj, null, 4) + ';';
                    fs.writeFileSync(infoPath, newContent, 'utf8');
                    
                    res.writeHead(200, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({ success: true, message: 'විස්තරය සාර්ථකව යාවත්කාලීන විය!' }));
                } else {
                    res.writeHead(404, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({ success: false, message: 'Invalid Key' }));
                }
            } catch (err) {
                console.error(err);
                res.writeHead(500, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({ success: false, message: 'Server Error: ' + err.message }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/upload-image') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { filename, base64 } = data;
                
                const imagesDir = path.join(DIR, 'images');
                if (!fs.existsSync(imagesDir)) {
                    fs.mkdirSync(imagesDir);
                }
                
                const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                if (!matches || matches.length !== 3) {
                    res.writeHead(400, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({ success: false, message: 'Invalid base64 string' }));
                    return;
                }
                
                const imageBuffer = Buffer.from(matches[2], 'base64');
                // Ensure filename is safe (basic sanitize)
                const safeName = filename.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
                const filePath = path.join(imagesDir, safeName);
                fs.writeFileSync(filePath, imageBuffer);
                
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({ success: true, url: 'images/' + safeName }));
            } catch (err) {
                console.error(err);
                res.writeHead(500, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({ success: false, message: 'Server Error: ' + err.message }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/update') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { originalWord, newWord, newMeaning, newCategory, newScientific, newImage } = data;
                
                let found = false;
                // data.js is the main one, data_*.js are the extras
                const allDataFiles = fs.readdirSync(DIR).filter(f => (f.startsWith('data_') || f === 'data.js') && f.endsWith('.js'));
                
                for (let file of allDataFiles) {
                    const filePath = path.join(DIR, file);
                    let content = fs.readFileSync(filePath, 'utf8');
                    
                    const lines = content.split('\n');
                    let modified = false;
                    
                    const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    for (let i = 0; i < lines.length; i++) {
                        let wordRegex = new RegExp(`(['"]?word['"]?\\s*:\\s*['"])${escapeRegExp(originalWord)}(['"])`);
                        if (lines[i].match(wordRegex)) {
                            // Update word
                            lines[i] = lines[i].replace(wordRegex, `$1${newWord}$2`);
                            
                            // Update meaning
                            let meaningRegex = /(['"]?meaning['"]?\s*:\s*)(["'])(?:(?=(\\?))\3.)*?\2/;
                            if (lines[i].match(meaningRegex)) {
                                lines[i] = lines[i].replace(meaningRegex, (match, p1) => {
                                    return p1 + JSON.stringify(newMeaning);
                                });
                            }
                            
                            // Update category
                            let categoryRegex = /(['"]?category['"]?\s*:\s*)(["'])(?:(?=(\\?))\3.)*?\2/;
                            if (lines[i].match(categoryRegex)) {
                                lines[i] = lines[i].replace(categoryRegex, (match, p1) => {
                                    return p1 + JSON.stringify(newCategory);
                                });
                            } else {
                                // If category didn't exist, inject it before the closing brace
                                lines[i] = lines[i].replace(/\s*}\s*(,?)\s*$/, `, "category": ${JSON.stringify(newCategory)} }$1`);
                            }
                            
                            // Update scientific
                            let scientificRegex = /(['"]?scientific['"]?\s*:\s*)(["'])(?:(?=(\\?))\3.)*?\2/;
                            if (newScientific !== undefined) {
                                if (lines[i].match(scientificRegex)) {
                                    lines[i] = lines[i].replace(scientificRegex, (match, p1) => {
                                        return p1 + JSON.stringify(newScientific);
                                    });
                                } else if (newScientific !== "") {
                                    lines[i] = lines[i].replace(/\s*}\s*(,?)\s*$/, `, "scientific": ${JSON.stringify(newScientific)} }$1`);
                                }
                            }
                            
                            // Update image
                            let imageRegex = /(['"]?image['"]?\s*:\s*)(["'])(?:(?=(\\?))\3.)*?\2/;
                            if (newImage !== undefined) {
                                if (lines[i].match(imageRegex)) {
                                    lines[i] = lines[i].replace(imageRegex, (match, p1) => {
                                        return p1 + JSON.stringify(newImage);
                                    });
                                } else if (newImage !== "") {
                                    lines[i] = lines[i].replace(/\s*}\s*(,?)\s*$/, `, "image": ${JSON.stringify(newImage)} }$1`);
                                }
                            }
                            
                            modified = true;
                            found = true;
                            break;
                        }
                    }
                    
                    if (modified) {
                        fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
                        console.log(`[Admin Edit] Updated word "${originalWord}" in ${file}`);
                        break; // Stop searching other files once found
                    }
                }
                
                if (found) {
                    res.writeHead(200, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({ success: true, message: 'වචනය සාර්ථකව යාවත්කාලීන විය!' }));
                } else {
                    res.writeHead(404, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({ success: false, message: 'මෙම වචනය ෆයිල් වල සොයාගැනීමට නොහැක.' }));
                }
                
            } catch (err) {
                console.error(err);
                res.writeHead(500, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({ success: false, message: 'Server Error: ' + err.message }));
            }
        });
    } else {
        // Serve static files
        let filePath = path.join(DIR, req.url === '/' ? 'index.html' : req.url);
        
        // Remove query params if any
        filePath = filePath.split('?')[0];

        let extname = path.extname(filePath);
        let contentType = 'text/html';
        switch (extname) {
            case '.js': contentType = 'text/javascript'; break;
            case '.css': contentType = 'text/css'; break;
            case '.json': contentType = 'application/json'; break;
            case '.png': contentType = 'image/png'; break;      
            case '.jpg': contentType = 'image/jpg'; break;
            case '.jpeg': contentType = 'image/jpeg'; break;
            case '.svg': contentType = 'image/svg+xml'; break;
        }

        fs.readFile(filePath, (err, content) => {
            if (err) {
                if(err.code == 'ENOENT') {
                    res.writeHead(404);
                    res.end("File not found");
                } else {
                    res.writeHead(500);
                    res.end('Server Error: ' + err.code);
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });
    }
});

server.listen(PORT, () => {
    console.log(`===========================================`);
    console.log(`  දේශීය වෙද්‍ය ශබ්දකෝෂය Local Server ධාවනය වේ!`);
    console.log(`  මෙහි පිවිසෙන්න: http://localhost:${PORT}`);
    console.log(`  Admin Password එක: Weda2026`);
    console.log(`===========================================`);
});
