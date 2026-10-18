package com.clibot.deriv

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class MainActivity : Activity() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private val http = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    private lateinit var appIdInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var accountSpinner: Spinner
    private lateinit var symbolSpinner: Spinner
    private lateinit var contractSpinner: Spinner
    private lateinit var barrierInput: EditText
    private lateinit var stakeInput: EditText
    private lateinit var triggerInput: EditText
    private lateinit var triggerModeSpinner: Spinner
    private lateinit var maxTradesInput: EditText
    private lateinit var startButton: Button
    private lateinit var stopButton: Button
    private lateinit var balanceLabel: TextView
    private lateinit var statusLabel: TextView
    private lateinit var logView: TextView
    private lateinit var logScroll: ScrollView

    private val requestIds = AtomicInteger(1)
    private val pending = mutableMapOf<Int, (JSONObject) -> Unit>()
    private var socket: WebSocket? = null
    @Volatile private var running = false
    @Volatile private var buyingOrSettling = false
    private var contractId: String? = null
    private var previousDigit: Int? = null
    private var tradeCount = 0
    private var wins = 0
    private var pnl = 0.0
    private var appToken: String = ""
    private var currentSymbol = "R_100"
    private var currentContract = "DIGITUNDER"
    private var currentBarrier = 9
    private var currentTriggerDigit = 9
    private var triggerOnDisappear = true
    private var maxTrades = 5
    private var stake = 1.0
    private var currency = "USD"
    private var selectedAccountId = ""
    private var selectedAccountType = "demo"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
    }

    private fun buildUi() {
        val scroller = ScrollView(this)
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.setPadding(dp(18), dp(16), dp(18), dp(14))
        content.setBackgroundColor(0xFFF4F6FA.toInt())
        scroller.addView(content)

        content.addView(text("Deriv Digit Bot", 26, true))
        content.addView(text("Credentials are used for this session only and are not saved.", 14))
        appIdInput = input("New Deriv App ID (letters and numbers)")
        appIdInput.inputType = InputType.TYPE_CLASS_TEXT
        content.addView(appIdInput)
        tokenInput = input("Personal Access Token")
        tokenInput.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        content.addView(tokenInput)

        content.addView(text("Account", 16, true))
        accountSpinner = spinner(listOf("Demo (recommended)", "Real"))
        content.addView(accountSpinner)
        content.addView(text("Market", 16, true))
        symbolSpinner = spinner(listOf("R_100", "R_10", "R_25", "R_50", "R_75", "1HZ100V"))
        content.addView(symbolSpinner)
        content.addView(text("Contract", 16, true))
        contractSpinner = spinner(listOf("UNDER", "OVER"))
        content.addView(contractSpinner)
        barrierInput = input("Barrier digit (0-9)", "9")
        content.addView(barrierInput)
        stakeInput = input("Stake in account currency", "1.00")
        content.addView(stakeInput)
        triggerInput = input("Wait for this digit", "9")
        content.addView(triggerInput)
        content.addView(text("Trigger timing", 16, true))
        triggerModeSpinner = spinner(listOf("When digit disappears (recommended)", "When digit appears"))
        content.addView(triggerModeSpinner)
        content.addView(text("Contract duration: 1 tick (fixed)", 14))
        maxTradesInput = input("Maximum number of trades", "5")
        content.addView(maxTradesInput)

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        startButton = Button(this).apply { text = "Start" }
        stopButton = Button(this).apply {
            text = "Stop"
            isEnabled = false
        }
        actions.addView(startButton, LinearLayout.LayoutParams(0, dp(52), 1f))
        actions.addView(stopButton, LinearLayout.LayoutParams(0, dp(52), 1f))
        content.addView(actions)

        balanceLabel = text("Balance: —", 18, true)
        statusLabel = text("Status: Idle", 15)
        content.addView(balanceLabel)
        content.addView(statusLabel)
        content.addView(text("Activity", 17, true))
        logView = text("Ready. Real trading uses real money; digits are random.", 14)
        logScroll = ScrollView(this).apply {
            setBackgroundColor(0xFFFFFFFF.toInt())
            addView(logView)
        }
        content.addView(logScroll, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(170)
        ))
        setContentView(scroller)

        startButton.setOnClickListener { startPressed() }
        stopButton.setOnClickListener { stopTrading("Stopped by user.") }
    }

    private fun startPressed() {
        val appId = appIdInput.text.toString().trim()
        val token = tokenInput.text.toString().trim()
        if (appId.isEmpty() || token.isEmpty()) {
            showError("Enter both your App ID and Personal Access Token.")
            return
        }
        val barrier = barrierInput.text.toString().toIntOrNull()
        val trigger = triggerInput.text.toString().toIntOrNull()
        val amount = stakeInput.text.toString().toDoubleOrNull()
        val tradeLimit = maxTradesInput.text.toString().toIntOrNull()
        if (barrier == null || barrier !in 0..9 || trigger == null || trigger !in 0..9) {
            showError("Barrier and trigger digit must be between 0 and 9.")
            return
        }
        if (amount == null || !amount.isFinite() || amount <= 0.0) {
            showError("Stake must be a positive amount.")
            return
        }
        if (tradeLimit == null || tradeLimit <= 0) {
            showError("Maximum trades must be a positive whole number.")
            return
        }
        val contract = if (contractSpinner.selectedItemPosition == 0) "DIGITUNDER" else "DIGITOVER"
        if ((contract == "DIGITOVER" && barrier == 9) ||
            (contract == "DIGITUNDER" && barrier == 0)
        ) {
            showError("That barrier cannot win for the selected contract.")
            return
        }

        appToken = token
        currentSymbol = symbolSpinner.selectedItem.toString()
        currentContract = contract
        currentBarrier = barrier
        currentTriggerDigit = trigger
        triggerOnDisappear = triggerModeSpinner.selectedItemPosition == 0
        maxTrades = tradeLimit
        stake = amount
        selectedAccountType = if (accountSpinner.selectedItemPosition == 0) "demo" else "real"
        if (selectedAccountType == "real") {
            AlertDialog.Builder(this)
                .setTitle("Real-money trading")
                .setMessage("This will place up to $maxTrades real trades at $stake each. Losses are possible. Continue?")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Continue") { _, _ -> startSession(appId) }
                .show()
        } else {
            startSession(appId)
        }
    }

    private fun startSession(appId: String) {
        running = true
        buyingOrSettling = false
        previousDigit = null
        tradeCount = 0
        wins = 0
        pnl = 0.0
        appIdInput.isEnabled = false
        tokenInput.isEnabled = false
        startButton.isEnabled = false
        stopButton.isEnabled = true
        status("Connecting to Deriv…")
        log("Looking up ${selectedAccountType.uppercase()} account for $currentSymbol.")
        executor.execute {
            try {
                val accounts = fetchAccounts(appId, appToken)
                val chosen = accounts.firstOrNull { accountType(it) == selectedAccountType }
                    ?: throw IOException("No $selectedAccountType account found on this token.")
                selectedAccountId = accountId(chosen)
                currency = chosen.optString("currency", "USD")
                val balance = chosen.optString("balance", "unknown")
                mainHandler.post {
                    if (!running) return@post
                    balanceLabel.text = "Balance at connection: $balance $currency"
                    log("Selected ${selectedAccountType.uppercase()} account $selectedAccountId.")
                    requestOtp(appId)
                }
            } catch (e: Exception) {
                fail("Account lookup failed: ${e.message ?: e.javaClass.simpleName}")
            }
        }
    }

    private fun fetchAccounts(appId: String, token: String): List<JSONObject> {
        val request = Request.Builder()
            .url("https://api.derivws.com/trading/v1/options/accounts")
            .header("Authorization", "Bearer $token")
            .header("Deriv-App-ID", appId)
            .get()
            .build()
        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw IOException("Accounts API returned HTTP ${response.code}: ${body.take(240)}")
            }
            val data = JSONObject(body).opt("data")
            val array = when (data) {
                is JSONArray -> data
                is JSONObject -> data.optJSONArray("accounts")
                    ?: JSONArray().put(data)
                else -> JSONArray()
            }
            return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
        }
    }

    private fun accountId(account: JSONObject): String =
        account.optString("account_id").takeIf { it.isNotBlank() }
            ?: account.optString("id").takeIf { it.isNotBlank() }
            ?: account.optString("loginid").takeIf { it.isNotBlank() }
            ?: throw IOException("Account response did not include an account ID.")

    private fun accountType(account: JSONObject): String {
        val explicit = account.optString("account_type", account.optString("type"))
            .lowercase()
        if (explicit.isNotBlank()) return explicit
        val id = runCatching { accountId(account) }.getOrDefault("").uppercase()
        return if (id.startsWith("DOT") || id.startsWith("VRT") || id.startsWith("DEM")) {
            "demo"
        } else {
            "real"
        }
    }

    private fun requestOtp(appId: String) {
        executor.execute {
            try {
                val encodedId = URLEncoder.encode(selectedAccountId, "UTF-8")
                val request = Request.Builder()
                    .url("https://api.derivws.com/trading/v1/options/accounts/$encodedId/otp")
                    .header("Authorization", "Bearer $appToken")
                    .header("Deriv-App-ID", appId)
                    .post(okhttp3.FormBody.Builder().build())
                    .build()
                http.newCall(request).execute().use { response ->
                    val body = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        throw IOException("OTP API returned HTTP ${response.code}: ${body.take(240)}")
                    }
                    val url = JSONObject(body).optJSONObject("data")?.optString("url")
                        ?.takeIf { it.startsWith("wss://") }
                        ?: throw IOException("OTP response did not contain a valid WebSocket URL.")
                    mainHandler.post {
                        if (!running) return@post
                        status("Connecting to account stream…")
                        connectSocket(url)
                    }
                }
            } catch (e: Exception) {
                fail("Could not open account stream: ${e.message ?: e.javaClass.simpleName}")
            }
        }
    }

    private fun connectSocket(url: String) {
        val request = Request.Builder().url(url).build()
        socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                postLog("Connected; subscribing to $currentSymbol ticks.")
                sendRequest(webSocket, JSONObject().put("ticks", currentSymbol).put("subscribe", 1)) {}
                val pingRunnable = object : Runnable {
                    override fun run() {
                        if (running && socket === webSocket) {
                            webSocket.send(JSONObject().put("ping", 1).toString())
                            mainHandler.postDelayed(this, 25_000)
                        }
                    }
                }
                mainHandler.postDelayed(pingRunnable, 25_000)
                mainHandler.post { status("Waiting for trigger digit…") }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val message = JSONObject(text)
                    val requestId = message.optInt("req_id", -1)
                    if (requestId >= 0) {
                        val callback = synchronized(pending) { pending.remove(requestId) }
                        if (callback != null) {
                            val error = message.optJSONObject("error")
                            if (error != null) {
                                val reason = error.optString("message", "Unknown API error")
                                fail("Deriv API error: $reason")
                            } else {
                                callback(message)
                            }
                        }
                    }
                    val tick = message.optJSONObject("tick")
                    if (tick != null) processTick(tick)
                    val openContract = message.optJSONObject("proposal_open_contract")
                    if (openContract != null && openContract.optBoolean("is_sold")) {
                        processSettlement(openContract)
                    }
                } catch (e: Exception) {
                    postLog("Could not process stream message: ${e.message}")
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                fail("WebSocket failed: ${t.message ?: "connection error"}")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (running) fail("WebSocket closed ($code): $reason")
            }
        })
    }

    private fun sendRequest(
        webSocket: WebSocket,
        payload: JSONObject,
        callback: (JSONObject) -> Unit
    ) {
        val id = requestIds.getAndIncrement()
        payload.put("req_id", id)
        synchronized(pending) { pending[id] = callback }
        if (!webSocket.send(payload.toString())) {
            synchronized(pending) { pending.remove(id) }
            fail("Could not send request to Deriv.")
        }
    }

    private fun processTick(tick: JSONObject) {
        if (!running) return
        val quote = tick.optDouble("quote", Double.NaN)
        val pipSize = tick.optInt("pip_size", 2).coerceIn(0, 8)
        if (!quote.isFinite()) return
        val digits = String.format(java.util.Locale.US, "%.${pipSize}f", quote)
            .filter(Char::isDigit)
        val digit = digits.lastOrNull()?.digitToIntOrNull() ?: return
        val previous = previousDigit
        previousDigit = digit
        if (buyingOrSettling || tradeCount >= maxTrades) return
        val triggered = if (triggerOnDisappear) {
            previous == currentTriggerDigit && digit != currentTriggerDigit
        } else {
            digit == currentTriggerDigit
        }
        if (triggered) {
            buyingOrSettling = true
            postLog("Trigger: $currentTriggerDigit ${if (triggerOnDisappear) "disappeared" else "appeared"}; placing one-tick trade.")
            mainHandler.post { status("Trigger fired; placing trade…") }
            placeTrade()
        }
    }

    private fun placeTrade() {
        val ws = socket ?: run {
            fail("WebSocket is not connected.")
            return
        }
        val parameters = JSONObject()
            .put("contract_type", currentContract)
            .put("underlying_symbol", currentSymbol)
            .put("barrier", currentBarrier.toString())
            .put("amount", stake)
            .put("basis", "stake")
            .put("currency", currency)
            .put("duration", 1)
            .put("duration_unit", "t")
        val payload = JSONObject()
            .put("buy", "1")
            .put("price", stake)
            .put("parameters", parameters)
        sendRequest(ws, payload) { response ->
            val buy = response.optJSONObject("buy")
            val cid = buy?.opt("contract_id")?.toString()
            if (cid.isNullOrBlank()) {
                buyingOrSettling = false
                postLog("Buy response did not contain a contract ID.")
                return@sendRequest
            }
            contractId = cid
            sendRequest(
                ws,
                JSONObject()
                    .put("proposal_open_contract", 1)
                    .put("contract_id", cid)
                    .put("subscribe", 1)
            ) { }
            postLog("Trade #${tradeCount + 1} placed: $currentContract $currentBarrier, stake $stake $currency.")
        }
    }

    private fun processSettlement(contract: JSONObject) {
        val cid = contract.opt("contract_id")?.toString()
        if (contractId != null && cid != contractId) return
        if (!buyingOrSettling) return
        val profit = contract.optDouble("profit", 0.0)
        tradeCount += 1
        if (profit > 0) wins += 1
        pnl += profit
        buyingOrSettling = false
        contractId = null
        postLog("Trade #$tradeCount ${if (profit > 0) "WON" else "LOST"}: ${formatAmount(profit)} $currency; session P/L ${formatAmount(pnl)}.")
        if (tradeCount >= maxTrades) {
            mainHandler.post { stopTrading("Completed $tradeCount trades: $wins wins, ${formatAmount(pnl)} $currency.") }
        } else {
            mainHandler.post { status("Waiting for trigger digit… ($tradeCount/$maxTrades trades)") }
        }
    }

    private fun formatAmount(amount: Double): String =
        String.format(java.util.Locale.US, "%+.2f", amount)

    private fun stopTrading(reason: String) {
        if (!running && socket == null) return
        val contractMayBeOpen = buyingOrSettling
        running = false
        socket?.close(1000, "Stopped")
        socket = null
        synchronized(pending) { pending.clear() }
        buyingOrSettling = false
        appToken = ""
        tokenInput.setText("")
        tokenInput.isEnabled = true
        appIdInput.isEnabled = true
        startButton.isEnabled = true
        stopButton.isEnabled = false
        status("Status: Stopped")
        if (contractMayBeOpen) {
            log("$reason A trade may still be settling; check your Deriv statement.")
        } else {
            log(reason)
        }
    }

    private fun fail(message: String) {
        mainHandler.post {
            if (running) {
                log(message)
                stopTrading("Stopped after an error.")
                status("Status: Error")
            } else {
                log(message)
            }
        }
    }

    private fun showError(message: String) {
        AlertDialog.Builder(this)
            .setTitle("Check settings")
            .setMessage(message)
            .setPositiveButton("OK", null)
            .show()
    }

    private fun status(message: String) {
        statusLabel.text = if (message.startsWith("Status:")) message else "Status: $message"
    }

    private fun postLog(message: String) {
        mainHandler.post { log(message) }
    }

    private fun log(message: String) {
        logView.append("\n${java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(java.util.Date())}  $message")
        logScroll.post { logScroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun input(hint: String, value: String = "") = EditText(this).apply {
        this.hint = hint
        setText(value)
        textSize = 16f
        singleLine = true
        setPadding(dp(12), dp(8), dp(12), dp(8))
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(52)
        ).apply { bottomMargin = dp(5) }
    }

    private fun spinner(options: List<String>) = Spinner(this).apply {
        adapter = ArrayAdapter(
            this@MainActivity,
            android.R.layout.simple_spinner_dropdown_item,
            options
        ).also {
            it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        }
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(48)
        )
    }

    private fun text(value: String, size: Int, bold: Boolean = false) =
        TextView(this).apply {
            text = value
            textSize = size.toFloat()
            setTextColor(0xFF182230.toInt())
            if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(0, dp(6), 0, dp(6))
        }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        stopTrading("App closed.")
        executor.shutdownNow()
        http.dispatcher.cancelAll()
        http.connectionPool.evictAll()
        super.onDestroy()
    }
}
