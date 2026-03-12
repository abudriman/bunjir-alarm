module.exports = {
    apps: [{
        name: "bunjir-alarm",
        script: "index.ts",
        interpreter: "bun",
        // Removing hardcoded Linux CWD so it uses the folder it's started from
        env: {
            NODE_ENV: "production",
        }
    }]
};
