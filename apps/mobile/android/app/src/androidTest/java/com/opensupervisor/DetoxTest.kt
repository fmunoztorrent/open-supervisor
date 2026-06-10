package com.opensupervisor

import com.wix.detox.Detox
import com.wix.detox.config.DetoxConfig
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.rule.ActivityTestRule

@RunWith(AndroidJUnit4::class)
class DetoxTest {
    @get:Rule
    var mActivityRule = ActivityTestRule(MainActivity::class.java, false, true)

    @Test
    fun runDetoxTests() {
        Detox.runTests(mActivityRule)
    }
}
