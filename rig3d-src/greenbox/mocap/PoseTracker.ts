/*
 * Video -> 33 body landmarks per frame, with MediaPipe Pose (Google, Apache-2.0), running in the browser.
 * Files are served from ./vendor/mediapipe-pose (no internet needed).
 *
 * Output per frame (three.js axes: +X = the person's left, +Y up, +Z towards the camera, metres, origin = hips):
 *   world: 33 x (x, y, z) or null when nobody was found
 *   img:   33 x (x, y) in 0..1 image coordinates (for root motion and the overlay)
 */
export interface PoseFrame { t: number, world: Float32Array | null, img: Float32Array | null, vis: Float32Array | null }

declare global { interface Window { Pose?: any } }

let loading: Promise<void> | null = null
function load_script (src: string): Promise<void> {
  if (window.Pose !== undefined) return Promise.resolve()
  if (loading !== null) return loading
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous'
    s.onload = () => resolve(); s.onerror = () => reject(new Error('could not load ' + src))
    document.head.appendChild(s)
  })
  return loading
}

export class PoseTracker {
  private pose: any = null
  private waiting: ((r: any) => void) | null = null

  constructor (private readonly base = './vendor/mediapipe-pose/') {}

  public async init (complexity: 0 | 1 = 1): Promise<void> {
    await load_script(this.base + 'pose.js')
    const Pose = window.Pose
    this.pose = new Pose({ locateFile: (f: string) => this.base + f })
    this.pose.setOptions({ modelComplexity: complexity, smoothLandmarks: true, enableSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 })
    this.pose.onResults((r: any) => { const w = this.waiting; this.waiting = null; w?.(r) })
    await this.pose.initialize()
  }

  private detect (image: HTMLVideoElement | HTMLCanvasElement): Promise<any> {
    return new Promise((resolve) => { this.waiting = resolve; void this.pose.send({ image }) })
  }

  /** step through the video at `fps`, from `t0` to `t1` seconds */
  public async track (video: HTMLVideoElement, fps: number, t0: number, t1: number, progress: (f: number, frame: PoseFrame) => void, cancelled: () => boolean): Promise<PoseFrame[]> {
    const out: PoseFrame[] = []
    const n = Math.max(1, Math.floor((t1 - t0) * fps))
    for (let i = 0; i <= n; i++) {
      if (cancelled()) break
      const t = Math.min(t1, t0 + i / fps)
      await seek(video, t)
      const r = await this.detect(video)
      const f: PoseFrame = { t: t - t0, world: null, img: null, vis: null }
      if (r.poseWorldLandmarks != null && r.poseLandmarks != null) {
        const W = new Float32Array(99); const I = new Float32Array(66); const V = new Float32Array(33)
        r.poseWorldLandmarks.forEach((p: any, k: number) => { W[k * 3] = p.x; W[k * 3 + 1] = -p.y; W[k * 3 + 2] = -p.z; V[k] = p.visibility ?? 1 })
        r.poseLandmarks.forEach((p: any, k: number) => { I[k * 2] = p.x; I[k * 2 + 1] = p.y })
        f.world = W; f.img = I; f.vis = V
      }
      out.push(f)
      progress(i / n, f)
    }
    return out
  }

  public close (): void { try { this.pose?.close() } catch { /* ignore */ } }
}

function seek (v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) { resolve(); return }
    const done = (): void => { v.removeEventListener('seeked', done); resolve() }
    v.addEventListener('seeked', done)
    v.currentTime = t
  })
}

/** MediaPipe Pose landmark indices */
export const LM = {
  nose: 0, ear_l: 7, ear_r: 8, shoulder_l: 11, shoulder_r: 12, elbow_l: 13, elbow_r: 14, wrist_l: 15, wrist_r: 16,
  pinky_l: 17, pinky_r: 18, index_l: 19, index_r: 20, hip_l: 23, hip_r: 24, knee_l: 25, knee_r: 26,
  ankle_l: 27, ankle_r: 28, heel_l: 29, heel_r: 30, toe_l: 31, toe_r: 32
} as const

export const BONES_2D: Array<[number, number]> = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 31], [24, 26], [26, 28], [28, 32], [15, 19], [16, 20], [0, 7], [0, 8]]
