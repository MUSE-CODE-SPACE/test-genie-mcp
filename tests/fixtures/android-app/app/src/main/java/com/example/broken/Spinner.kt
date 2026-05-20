// Deliberately broken Android fixture: !! null assertion + unregistered receiver.
package com.example.broken

import android.app.Activity
import android.content.BroadcastReceiver

class Spinner(val name: String?) {
    fun greet() {
        // BUG: `name!!` will throw NullPointerException when name is null.
        println("Hello, ${name!!.uppercase()}")
    }
}

class MyActivity : Activity() {
    private val receiver: BroadcastReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: android.content.Context?, intent: android.content.Intent?) {}
    }
    // BUG: no `override fun onDestroy() { super.onDestroy(); unregisterReceiver(receiver) }`
}
