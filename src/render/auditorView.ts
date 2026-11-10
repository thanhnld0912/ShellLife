// Hình dạng Người Kiểm Kê và tia quét đỏ. Tạm dùng khối đơn giản; sau thay bằng model Blender.

import * as THREE from 'three';
import type { Auditor } from '../sim/auditor.ts';

const SCANNER_Y = 1.25;

export class AuditorView {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private beamPivot = new THREE.Group();
  private cone: THREE.Mesh;
  private coneMat: THREE.MeshBasicMaterial;
  private laser: THREE.Line;
  private spot: THREE.SpotLight;
  private head: THREE.Group;
  private marker: THREE.Mesh;
  private range = 0;
  private half = 0;
  private walkT = 0;

  constructor(scene: THREE.Scene) {
    const uniform = new THREE.MeshLambertMaterial({ color: 0x1f2a33 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x111417 });

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.15, 12), uniform);
    torso.position.y = 1.3;
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.75, 10), dark);
    legs.position.y = 0.38;
    this.head = new THREE.Group();
    this.head.position.y = 2.0;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), new THREE.MeshLambertMaterial({ color: 0x8a8378 }));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 14), dark);
    cap.position.y = 0.08;
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.2), dark);
    brim.position.set(0, 0.04, 0.14);
    this.head.add(skull, cap, brim);
    this.head.rotation.x = 0.45; // luôn cúi nhìn máy quét
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.45), uniform);
    arm.position.set(0.12, SCANNER_Y, 0.22);
    const scanner = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.12), dark);
    scanner.position.set(0.12, SCANNER_Y, 0.46);
    const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.08), new THREE.MeshBasicMaterial({ color: 0xe9e4d4 }));
    badge.position.set(-0.1, 1.6, 0.235);
    this.body.add(torso, legs, this.head, arm, scanner, badge);
    this.group.add(this.body);

    this.coneMat = new THREE.MeshBasicMaterial({
      color: 0xff3b30,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.cone = new THREE.Mesh(new THREE.BufferGeometry(), this.coneMat);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
    this.laser = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xff3b30, toneMapped: false }));
    this.spot = new THREE.SpotLight(0xff3b30, 22, 10, 0.3, 0.6, 1.2);
    const tgt = new THREE.Object3D();
    tgt.position.set(0, -0.4, 5);
    this.beamPivot.add(this.cone, this.laser, this.spot, tgt);
    this.spot.target = tgt;
    this.beamPivot.position.set(0.12, SCANNER_Y, 0.5);
    this.group.add(this.beamPivot);

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.25, 0.32, 24),
      new THREE.MeshBasicMaterial({ color: 0x6fc3df, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    scene.add(this.group, this.marker);
  }

  private setShape(range: number, half: number): void {
    if (range === this.range && half === this.half) return;
    this.range = range;
    this.half = half;
    const g = new THREE.ConeGeometry(Math.tan(half) * range, range, 24, 1, true);
    g.translate(0, -range / 2, 0);
    g.rotateX(-Math.PI / 2); // đỉnh ở gốc, đáy hướng về +Z
    this.cone.geometry.dispose();
    this.cone.geometry = g;
    this.laser.scale.set(1, 1, range);
    this.spot.distance = range + 1;
    this.spot.angle = half * 1.35;
  }

  update(a: Auditor, dt: number, debug: boolean): void {
    this.setShape(a.tune.range, a.tune.halfAngle);
    const hidden = a.state === 'idle';
    this.group.visible = !hidden;
    this.group.position.set(a.pos.x, 0, a.pos.z);
    this.group.rotation.y = a.heading;
    this.beamPivot.rotation.y = a.beam - a.heading;
    if (a.moving) this.walkT += dt * 7;
    this.body.position.y = a.moving ? Math.abs(Math.sin(this.walkT)) * 0.03 : 0;
    this.body.rotation.z = a.moving ? Math.sin(this.walkT) * 0.025 : 0;
    // Ngẩng đầu khi nghe thấy hoặc đang đếm
    const lookUp = a.state === 'alert' || a.state === 'count' || a.state === 'search';
    this.head.rotation.x += ((lookUp ? -0.05 : 0.45) - this.head.rotation.x) * Math.min(1, dt * 6);
    const counting = a.state === 'count';
    this.coneMat.opacity = counting ? 0.22 + Math.sin(performance.now() / 60) * 0.06 : 0.12;
    this.spot.intensity = counting ? 34 : 22;
    this.marker.visible = debug && !!a.suspicion;
    if (a.suspicion) this.marker.position.set(a.suspicion.x, 0.02, a.suspicion.z);
  }
}
