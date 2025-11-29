const GOTIFY_URL = 'http://localhost:8060';
const GOTIFY_APP_TOKEN = 'APYMjnEFwaoKHHD';

async function sendGotify(p?: { title: string, message: string }) {
    console.log('Attempting to send alarm notification to Gotify...');

    const endpoint = `${GOTIFY_URL}/message?token=${GOTIFY_APP_TOKEN}`;

    // Define the message payload
    const payload = {
        title: p?.title || '🔴 Critical System Alert!',
        message: p?.message || `A repetitive alarm was triggered at ${new Date().toLocaleTimeString()}`,
        priority: 5, // Priority 5 is typically high/critical
        extras: {
            // Optional: Specify content type as markdown if you want rich text
            "client::display": {
                "contentType": "text/markdown"
            }
        }
    };

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Alternatively, you can pass the token in the header:
                // 'X-Gotify-Key': GOTIFY_APP_TOKEN
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            console.log('Gotify notification sent successfully!');
        } else {
            const errorText = await response.text();
            console.error(`Failed to send Gotify notification. Status: ${response.status}. Response: ${errorText}`);
        }

    } catch (error) {
        console.error('An error occurred while connecting to Gotify:', error);
    }
}

export default sendGotify