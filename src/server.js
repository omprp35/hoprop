const express = require('express');
const config = require('./config');
const { BrowserSession } = require('./browser');
const { sendMessage, sendMenu, setupWebhook } = require('./telegram');
const { verifyIndia, claimAndApply, netflixStartAndSendLink, finishSignup, validateNetflixLink } = require('./signup');

const app = express();
app.use(express.json({ limit: '1mb' }));

const browser = new BrowserSession();
const flows = new Map();
let workflowOwner = null;

function isAuthorized(chatId) {
  return config.authorizedChatIds.size === 0 || config.authorizedChatIds.has(String(chatId));
}

function desktopUrl() {
  return `${config.publicUrl}/desktop/vnc.html?autoconnect=1&resize=scale&path=desktop/websockify`;
}

async function sendDesktop(chatId, message = '🖥 Live browser desktop is ready.') {
  if (!config.publicUrl) throw new Error('PUBLIC_URL is not configured.');
  const username = process.env.DESKTOP_USERNAME || 'browser';
  await sendMessage(
    chatId,
    `${message}\n\nUsername: ${username}\nPassword: your DESKTOP_PASSWORD Railway variable.\n\n` +
      'This is the same persistent Chromium profile used by the signup workflow.',
    {
      reply_markup: {
        inline_keyboard: [[{ text: '🌐 Open Live Desktop', url: desktopUrl() }]]
      }
    }
  );
}

function clearFlow(chatId) {
  flows.delete(String(chatId));
  if (String(workflowOwner) === String(chatId)) workflowOwner = null;
}

function getFlow(chatId) {
  return flows.get(String(chatId));
}

function setFlow(chatId, value) {
  flows.set(String(chatId), value);
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

app.get('/health', (req, res) => res.status(200).send('ok'));

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'live-browser-netflix-signup',
    browserActive: browser.active,
    profileDir: config.profileDir,
    workflowActive: Boolean(workflowOwner)
  });
});

app.post('/telegram', async (req, res) => {
  const secret = req.get('x-telegram-bot-api-secret-token');
  if (secret !== config.webhookSecret) return res.status(401).json({ ok: false });

  res.status(200).json({ ok: true });

  const message = req.body?.message;
  const chatId = message?.chat?.id;
  const rawText = message?.text?.trim();
  if (!chatId || !rawText) return;

  const buttonCommands = {
    '▶️ Start Signup': '/signup',
    '🖥 Live Desktop': '/desktop',
    '🔄 Restart Browser': '/restart',
    '❌ Close Browser': '/close',
    '🛑 Cancel Signup': '/cancel',
    '✅ I Verified India': '/location_ok'
  };
  const text = buttonCommands[rawText] || rawText;

  try {
    if (!isAuthorized(chatId)) {
      await sendMessage(chatId, `Not authorized. Your Telegram chat ID is: ${chatId}`);
      return;
    }

    if (text === '/start' || text === '/help' || text === '/menu') {
      await sendMenu(
        chatId,
        'Browser signup bot\n\n' +
          '▶️ Start Signup — verify India, ask for email, run extension + Netflix steps\n' +
          '🖥 Live Desktop — manually inspect/control the same Chromium session\n' +
          '🛑 Cancel Signup — forget the current email/link workflow\n\n' +
          'Surfshark is never switched automatically. Connect it to India manually in Live Desktop and keep Auto-connect enabled.'
      );
      return;
    }

    if (text === '/id') {
      await sendMenu(chatId, `Your Telegram chat ID: ${chatId}`);
      return;
    }

    if (text === '/desktop') {
      const wasActive = browser.active;
      if (!wasActive) {
        await sendMessage(chatId, 'Starting Chromium…');
        await browser.start();
      }
      await sendDesktop(chatId, wasActive ? '🖥 Desktop is already running.' : '🖥 Chromium started.');
      return;
    }

    if (text === '/restart') {
      if (workflowOwner) {
        await sendMenu(chatId, 'A signup workflow is active. Cancel it first with 🛑 Cancel Signup before restarting Chromium.');
        return;
      }
      await sendMessage(chatId, 'Restarting Chromium…');
      await browser.restart();
      await sendDesktop(chatId, '✅ Chromium restarted with the same saved profile.');
      return;
    }

    if (text === '/close') {
      if (workflowOwner) {
        await sendMenu(chatId, 'A signup workflow is active. Cancel it first with 🛑 Cancel Signup before closing Chromium.');
        return;
      }
      await browser.close();
      await sendMenu(chatId, '✅ Chromium closed. Your saved profile remains on the Railway Volume.');
      return;
    }

    if (text === '/cancel') {
      clearFlow(chatId);
      await sendMenu(chatId, '✅ Signup workflow cancelled. Email/link data was cleared from memory.');
      return;
    }

    if (text === '/signup') {
      if (workflowOwner && String(workflowOwner) !== String(chatId)) {
        await sendMenu(chatId, 'Another signup workflow is already running.');
        return;
      }

      workflowOwner = String(chatId);
      setFlow(chatId, { step: 'checking_location' });
      await sendMessage(chatId, 'Checking the browser IP with automated geolocation databases…');

      try {
        const context = await browser.ensure();
        const vpn = await verifyIndia(context);
        const details = vpn.results.map(r => `${r.service}: ${r.country}/${r.ip}`).join('\n');
        setFlow(chatId, { step: 'awaiting_email' });
        await sendMenu(chatId, `✅ India verified automatically.\n${details}\n\nSend the email address to use for signup:`);
      } catch (error) {
        // Surfshark virtual India IPs can be classified by some public databases
        // according to the physical backend rather than their virtual country.
        // Do not destroy the workflow. Let the user inspect this SAME Chromium
        // session through Live Desktop and explicitly confirm before continuing.
        setFlow(chatId, {
          step: 'awaiting_location_confirmation',
          locationWarning: error.message
        });

        await sendMessage(
          chatId,
          `⚠️ Automatic location databases did not verify India.\n\n${error.message}\n\n` +
            'If you already connected Surfshark manually, open Live Desktop and check the location in the SAME browser. ' +
            'If the site you care about shows India, tap ✅ I Verified India to continue. The signup will stay paused until then.',
          {
            reply_markup: {
              keyboard: [
                [{ text: '🖥 Live Desktop' }, { text: '✅ I Verified India' }],
                [{ text: '🛑 Cancel Signup' }]
              ],
              resize_keyboard: true,
              is_persistent: true
            }
          }
        );
      }
      return;
    }

    if (text === '/location_ok') {
      const flow = getFlow(chatId);
      if (!flow || flow.step !== 'awaiting_location_confirmation') {
        await sendMenu(chatId, 'There is no signup waiting for manual India confirmation. Tap ▶️ Start Signup first.');
        return;
      }

      setFlow(chatId, {
        step: 'awaiting_email',
        manualIndiaConfirmation: true,
        confirmedAt: Date.now()
      });
      await sendMenu(
        chatId,
        '✅ Manual India confirmation accepted for this signup session.\n\nSend the email address to use for signup:'
      );
      return;
    }

    const flow = getFlow(chatId);
    if (!flow) return;

    if (flow.step === 'awaiting_email') {
      if (!looksLikeEmail(text)) {
        await sendMessage(chatId, 'Send a valid email address, for example name@example.com');
        return;
      }

      const email = text.trim();
      setFlow(chatId, { step: 'running_to_email_link', email });
      await sendMessage(chatId, 'Running extension Claim/Apply and Netflix signup steps…');

      try {
        const netflixPage = await claimAndApply(browser, email);
        await netflixStartAndSendLink(netflixPage, email);
        setFlow(chatId, { step: 'awaiting_netflix_link', email });
        await sendMessage(
          chatId,
          '✅ Netflix asked to send the signup link.\n\nCheck that email inbox and paste the FULL Netflix link here.\n\nThe link is used once in this browser session and is not saved to disk.'
        );
      } catch (error) {
        clearFlow(chatId);
        await sendMenu(chatId, `❌ Signup stopped: ${error.message}\n\nUse 🖥 Live Desktop to inspect the browser if the page/extension UI changed.`);
      }
      return;
    }

    if (flow.step === 'awaiting_netflix_link') {
      let link;
      try {
        link = validateNetflixLink(text);
      } catch (error) {
        await sendMessage(chatId, `❌ ${error.message}`);
        return;
      }

      setFlow(chatId, { step: 'finishing_signup', email: flow.email });
      await sendMessage(chatId, 'Opening the Netflix email link in the same browser and finishing signup…');

      try {
        const result = await finishSignup(browser, link);
        clearFlow(chatId);
        await sendMenu(chatId, `✅ Finish Sign Up clicked.\nPage: ${result.title || result.url}`);
      } catch (error) {
        clearFlow(chatId);
        await sendMenu(chatId, `❌ Could not finish signup: ${error.message}\n\nUse 🖥 Live Desktop to inspect the current Netflix page.`);
      }
      return;
    }
  } catch (error) {
    console.error('Telegram command failed:', error);
    try {
      clearFlow(chatId);
      await sendMenu(chatId, `❌ ${error.message}`);
    } catch {}
  }
});

app.listen(config.port, '0.0.0.0', async () => {
  console.log(`Listening on 0.0.0.0:${config.port}`);
  console.log(`Persistent browser profile: ${config.profileDir}`);
  try {
    await setupWebhook();
  } catch (error) {
    console.error('Webhook setup failed:', error.message);
  }
});
