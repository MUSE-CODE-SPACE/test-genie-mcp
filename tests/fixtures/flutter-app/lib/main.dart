// Deliberately broken fixture: AnimationController without dispose → leak.
import 'package:flutter/material.dart';

class Spinner extends StatefulWidget {
  @override
  State<Spinner> createState() => _SpinnerState();
}

class _SpinnerState extends State<Spinner> with SingleTickerProviderStateMixin {
  late AnimationController controller;

  @override
  void initState() {
    super.initState();
    controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat();
  }

  // BUG: no `dispose() { controller.dispose(); super.dispose(); }`

  @override
  Widget build(BuildContext context) {
    return RotationTransition(turns: controller, child: const Icon(Icons.refresh));
  }
}
