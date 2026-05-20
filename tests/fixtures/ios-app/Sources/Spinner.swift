// Deliberately broken iOS fixture: strong-self closure → retain cycle.
import Foundation
import UIKit

final class Spinner: UIViewController {
    var timer: Timer?

    func start() {
        self.timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            // BUG: closure captures `self` strongly. Should be `[weak self] _ in ...`.
            self.tick()
        }
    }

    func tick() {
        print("tick")
    }

    // BUG: no `deinit { timer?.invalidate() }`
}
