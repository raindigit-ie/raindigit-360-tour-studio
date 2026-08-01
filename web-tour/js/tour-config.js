window.TOUR_CONFIG = {
  title: "Killarney Interior 360",
  firstScene: "scene-001",
  scenes: [
    {
      id: "scene-001",
      title: "Kitchen dining",
      subtitle: "Dining-side view",
      space: "kitchen",
      spaceLabel: "Kitchen",
      thumb: "thumbnails/scene-001.jpg",
      panorama: "panoramas/scene-001.jpg",
      // Start low enough to keep both verified navigation points in view.
      pitch: -19,
      yaw: -95,
      hfov: 94,
      hotspots: [
        {
          kind: "viewpoint",
          // Camera 002 is beside the fixed white-door wall, not the table.
          // Measured from the closed-door threshold and cabinet/floor grid.
          pitch: -37,
          yaw: -125,
          target: "scene-002",
          label: "Move to main kitchen view",
          targetYaw: 78,
          targetPitch: -19,
          targetHfov: 94,
          registration: {
            method: "Manual bidirectional structural review",
            sourceEvidence: "qa/arrival-audit/nadir-scene-001-grid.jpg",
            targetEvidence: "qa/arrival-audit/nadir-scene-002-grid.jpg",
            anchors: "Visible tripod footprint, fixed white-door wall, fixed cabinetry, and checkerboard floor"
          }
        },
        {
          kind: "doorway",
          // The open doorway below the stairs is visible from this view.
          pitch: -18.5,
          yaw: -87.2,
          target: "scene-003",
          label: "Walk to hall",
          targetYaw: 90,
          targetPitch: -10,
          targetHfov: 86
        }
      ]
    },
    {
      id: "scene-002",
      title: "Kitchen",
      subtitle: "Main room view",
      space: "kitchen",
      spaceLabel: "Kitchen",
      thumb: "thumbnails/scene-002.jpg",
      panorama: "panoramas/scene-002.jpg",
      // The matching lower default keeps the return point in the visible floor area.
      pitch: -19,
      yaw: 78,
      hfov: 94,
      hotspots: [
        {
          kind: "viewpoint",
          // Camera 001 is on the open checkerboard floor toward the cabinets.
          pitch: -38,
          yaw: 98,
          target: "scene-001",
          label: "Move to dining-side kitchen view",
          targetYaw: -95,
          targetPitch: -19,
          targetHfov: 94,
          registration: {
            method: "Manual bidirectional structural review",
            sourceEvidence: "qa/arrival-audit/nadir-scene-002-grid.jpg",
            targetEvidence: "qa/arrival-audit/nadir-scene-001-grid.jpg",
            anchors: "Visible tripod footprint, fixed white-door wall, fixed cabinetry, and checkerboard floor"
          }
        },
        {
          kind: "doorway",
          pitch: -30,
          yaw: -142,
          target: "scene-003",
          label: "Walk to hall",
          targetYaw: 90,
          targetPitch: -10,
          targetHfov: 86
        }
      ]
    },
    {
      id: "scene-003",
      title: "Hall",
      subtitle: "Staircase",
      space: "hall",
      spaceLabel: "Hall",
      thumb: "thumbnails/scene-003.jpg",
      panorama: "panoramas/scene-003.jpg",
      pitch: -10,
      yaw: 90,
      hfov: 86,
      hotspots: [
        {
          kind: "doorway",
          pitch: -30,
          yaw: -100,
          target: "scene-002",
          label: "Walk to kitchen",
          targetYaw: 78,
          targetPitch: -19,
          targetHfov: 94
        },
        {
          kind: "doorway",
          pitch: -30,
          yaw: 135,
          target: "scene-004",
          label: "Walk to living room",
          targetYaw: 25,
          targetPitch: -14,
          targetHfov: 86
        }
      ]
    },
    {
      id: "scene-004",
      title: "Living Room",
      subtitle: "Lounge view",
      space: "living",
      spaceLabel: "Living room",
      thumb: "thumbnails/scene-004.jpg",
      panorama: "panoramas/scene-004.jpg",
      pitch: -14,
      yaw: 25,
      hfov: 86,
      hotspots: [
        {
          kind: "doorway",
          pitch: -30,
          yaw: -104,
          target: "scene-003",
          label: "Walk to hall",
          targetYaw: 90,
          targetPitch: -10,
          targetHfov: 86
        }
      ]
    }
  ]
};
