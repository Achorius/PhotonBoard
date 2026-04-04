import * as THREE from 'three'
import type { RoomConfig } from '@shared/types'

/**
 * Build the room geometry: floor, ceiling, 3 walls, grid helper.
 * Origin is at the centre of the stage floor (Y = 0).
 */
export function buildRoom(config: RoomConfig): THREE.Group {
  const { width, depth, height } = config
  const group = new THREE.Group()
  group.name = 'room'

  // ---- Floor ----
  const floorGeo = new THREE.PlaneGeometry(width, depth)
  floorGeo.rotateX(-Math.PI / 2)
  const floorMat = new THREE.MeshLambertMaterial({
    color: 0x0d0d14,
    side: THREE.FrontSide
  })
  const floor = new THREE.Mesh(floorGeo, floorMat)
  floor.receiveShadow = true
  floor.name = 'floor'
  group.add(floor)

  // ---- Grid ----
  const gridHelper = new THREE.GridHelper(Math.max(width, depth), Math.max(width, depth) * 2, 0x1a1a2e, 0x16162a)
  gridHelper.name = 'grid'
  group.add(gridHelper)

  // ---- Ceiling ----
  const ceilGeo = new THREE.PlaneGeometry(width, depth)
  ceilGeo.rotateX(Math.PI / 2)
  const ceilMat = new THREE.MeshLambertMaterial({
    color: 0x0a0a10,
    side: THREE.FrontSide
  })
  const ceiling = new THREE.Mesh(ceilGeo, ceilMat)
  ceiling.position.y = height
  ceiling.receiveShadow = true
  ceiling.name = 'ceiling'
  group.add(ceiling)

  // ---- Back wall (upstage, +Z) ----
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x0c0c16, side: THREE.FrontSide })
  const backGeo = new THREE.PlaneGeometry(width, height)
  const backWall = new THREE.Mesh(backGeo, wallMat)
  backWall.position.set(0, height / 2, depth / 2)
  backWall.rotation.y = Math.PI
  backWall.receiveShadow = true
  backWall.name = 'wall-back'
  group.add(backWall)

  // ---- Left wall ----
  const leftGeo = new THREE.PlaneGeometry(depth, height)
  const leftWall = new THREE.Mesh(leftGeo, wallMat.clone())
  leftWall.position.set(-width / 2, height / 2, 0)
  leftWall.rotation.y = Math.PI / 2
  leftWall.receiveShadow = true
  leftWall.name = 'wall-left'
  group.add(leftWall)

  // ---- Right wall ----
  const rightGeo = new THREE.PlaneGeometry(depth, height)
  const rightWall = new THREE.Mesh(rightGeo, wallMat.clone())
  rightWall.position.set(width / 2, height / 2, 0)
  rightWall.rotation.y = -Math.PI / 2
  rightWall.receiveShadow = true
  rightWall.name = 'wall-right'
  group.add(rightWall)

  // ---- Stage edge line ----
  const edgePts = [
    new THREE.Vector3(-width / 2, 0.01, 0),
    new THREE.Vector3(width / 2, 0.01, 0)
  ]
  const edgeLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(edgePts),
    new THREE.LineBasicMaterial({ color: 0xe85d04, opacity: 0.5, transparent: true })
  )
  edgeLine.name = 'stage-edge'
  group.add(edgeLine)

  // ---- Truss pipe outlines along ceiling ----
  addTruss(group, width, depth, height)

  return group
}

function addTruss(group: THREE.Group, width: number, depth: number, height: number): void {
  const trussMat = new THREE.MeshLambertMaterial({ color: 0x333355 })
  const pipeR = 0.03
  const trussPositions = [
    { z: -depth * 0.3, label: 'front' },
    { z: 0,            label: 'mid'   },
    { z: depth * 0.3,  label: 'back'  }
  ]
  for (const { z, label } of trussPositions) {
    const pipeGeo = new THREE.CylinderGeometry(pipeR, pipeR, width, 6)
    pipeGeo.rotateZ(Math.PI / 2)
    const pipe = new THREE.Mesh(pipeGeo, trussMat)
    pipe.position.set(0, height - 0.05, z)
    pipe.name = `truss-${label}`
    group.add(pipe)
  }
}

/**
 * Show/hide the grid helper.
 */
export function setGridVisible(room: THREE.Group, visible: boolean): void {
  const grid = room.getObjectByName('grid')
  if (grid) grid.visible = visible
}
