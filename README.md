# Cli-bot-

## Android app

An Android UI is included under `app/`. It supports the Deriv App ID and PAT,
demo or real account selection, market, OVER/UNDER barrier, stake, trigger digit,
appearance/disappearance trigger mode, a one-tick contract, trade limit, live
status, and a stop button. The default configuration is demo, `R_100`,
`DIGITUNDER 9`, and trade-after-9-disappears. Credentials are kept in memory for
the session and the PAT field is cleared when the session stops. Real trading
requires an explicit confirmation. Digit outcomes are random; this app cannot
predict the market or guarantee recovery/profit.

To build an APK, open this repository in Android Studio with Android SDK
Platform 35 installed, then run the `assembleDebug` Gradle task. The APK is
written to `app/build/outputs/apk/debug/app-debug.apk`.

## Configure credentials

Put your Deriv credentials in `.env` in the repository root:

```dotenv
DERIV_APP_ID=your_app_id
DERIV_PAT=your_personal_access_token
```

The bot reads `.env` automatically. Keep this file private; it is ignored by Git.
The token needs trading permission and must be associated with the App ID. You
can also copy `.env.example` as a template or set these environment variables.

Install dependencies and run on the demo account first:

```sh
pip install websockets requests
python deriv_overunder_bot.py --account demo
```

The default `--account both` includes real trading when a real account is
available. Real trading requires confirmation unless `--yes-real` is specified.
Digits on synthetic indices are random; the bot has no predictive edge.
