package expo.modules.chandastimerservice

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FocusModeControllerTest {
  @Test
  fun deactivationIsPauseOnlyForAnActiveRequest() {
    assertTrue(FocusModeController.shouldTreatDeactivationAsPause(
      requestedActive = true,
      automationEnabled = true,
      timerRunning = true,
    ))
    assertFalse(FocusModeController.shouldTreatDeactivationAsPause(
      requestedActive = false,
      automationEnabled = true,
      timerRunning = true,
    ))
    assertFalse(FocusModeController.shouldTreatDeactivationAsPause(
      requestedActive = true,
      automationEnabled = true,
      timerRunning = false,
    ))
    assertFalse(FocusModeController.shouldTreatDeactivationAsPause(
      requestedActive = true,
      automationEnabled = false,
      timerRunning = true,
    ))
  }
}
