package dev.slipstream.media

import android.content.Context
import android.hardware.display.DisplayManager
import android.media.MediaCodecInfo
import android.media.MediaCodecInfo.CodecProfileLevel
import android.media.MediaCodecList
import android.os.Build
import android.util.Log
import android.view.Display
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioCapabilities
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * What this device can play, read fresh for every playback session (so a receiver switched on or
 * off, or an HDMI cable plugged in, counts from the next session on):
 *
 * - `passthrough`: the compressed audio formats the current audio route takes as they are,
 *   asked the way Media3's audio sink asks (AudioCapabilities), so what is reported is what
 *   react-native-video will pass through. A phone's speaker takes none; an Android TV or a
 *   Shield on an AV receiver over HDMI takes AC-3 and E-AC-3, often DTS and TrueHD.
 * - `audio`, `video`: the MediaCodec decoders (MIME types), with each video decoder's profiles
 *   (named as ffprobe names them) and largest picture. Hardware decoders count over software
 *   ones for the same type, since software decoding cannot keep up with HD on most devices.
 * - `hdr`: whether the display shows any HDR format.
 *
 * JavaScript maps MIME types to codec names (src/player/capabilities.ts). Every probe is logged
 * (`adb logcat -s SlipstreamMedia`), so what a TV and its receiver report can be read on the
 * device itself.
 */
class MediaCapabilitiesModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SlipstreamMediaCapabilities")

    // Once at start, so the log shows what the device offers before anything plays.
    OnCreate { probe(context) }

    Function("probe") { probe(context) }
  }

  private class VideoEntry {
    val profiles = sortedSetOf<String>()
    var maxWidth = 0
    var maxHeight = 0
  }

  @OptIn(markerClass = [UnstableApi::class])
  private fun passthrough(context: Context): List<String> {
    val capabilities = AudioCapabilities.getCapabilities(context, AudioAttributes.DEFAULT, null)
    return passthroughEncodings
      .filter { (_, encoding) -> capabilities.supportsEncoding(encoding) }
      .map { (codec, _) -> codec }
      .distinct()
  }

  private fun probe(context: Context): Map<String, Any> {
    val hardware = mutableMapOf<String, VideoEntry>()
    val software = mutableMapOf<String, VideoEntry>()
    val audio = sortedSetOf<String>()
    for (info in MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos) {
      if (info.isEncoder) continue
      for (type in info.supportedTypes) {
        val mime = type.lowercase()
        if (mime.startsWith("audio/")) {
          audio.add(mime)
          continue
        }
        if (!mime.startsWith("video/")) continue
        val capabilities =
          try {
            info.getCapabilitiesForType(type)
          } catch (_: IllegalArgumentException) {
            continue
          }
        val video = capabilities.videoCapabilities ?: continue
        val entries = if (isSoftwareOnly(info)) software else hardware
        val entry = entries.getOrPut(mime) { VideoEntry() }
        entry.maxWidth = maxOf(entry.maxWidth, video.supportedWidths.upper)
        entry.maxHeight = maxOf(entry.maxHeight, video.supportedHeights.upper)
        for (level in capabilities.profileLevels) {
          profileName(mime, level.profile)?.let { entry.profiles.add(it) }
        }
      }
    }
    val video = (software + hardware).map { (mime, entry) ->
      mapOf(
        "mime" to mime,
        "profiles" to entry.profiles.toList(),
        "maxWidth" to entry.maxWidth,
        "maxHeight" to entry.maxHeight,
      )
    }
    val report =
      mapOf(
        "video" to video,
        "audio" to audio.toList(),
        "passthrough" to passthrough(context),
        "hdr" to hdr(context),
      )
    Log.i(TAG, "Media capabilities: $report")
    return report
  }

  /** Software decoders by flag where Android says so, else by the platform's naming. */
  private fun isSoftwareOnly(info: MediaCodecInfo): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      info.isSoftwareOnly
    } else {
      val name = info.name.lowercase()
      name.startsWith("omx.google.") || name.startsWith("c2.android.")
    }

  private fun hdr(context: Context): Boolean {
    val displays = context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
    val display = displays.getDisplay(Display.DEFAULT_DISPLAY) ?: return false
    @Suppress("DEPRECATION")
    return display.hdrCapabilities?.supportedHdrTypes?.isNotEmpty() == true
  }

  private companion object {
    const val TAG = "SlipstreamMedia"

    /** Compressed formats an audio route may take as they are, by Slipstream's codec name. */
    val passthroughEncodings =
      listOf(
        "ac3" to C.ENCODING_AC3,
        "eac3" to C.ENCODING_E_AC3,
        "eac3" to C.ENCODING_E_AC3_JOC,
        "dts" to C.ENCODING_DTS,
        "dts" to C.ENCODING_DTS_HD,
        "truehd" to C.ENCODING_DOLBY_TRUEHD,
      )

    /** A decoder profile as ffprobe names it, for the profiles the server compares with. */
    fun profileName(mime: String, profile: Int): String? =
      when (mime) {
        "video/avc" ->
          when (profile) {
            CodecProfileLevel.AVCProfileBaseline,
            CodecProfileLevel.AVCProfileConstrainedBaseline -> "Baseline"
            CodecProfileLevel.AVCProfileMain -> "Main"
            CodecProfileLevel.AVCProfileExtended -> "Extended"
            CodecProfileLevel.AVCProfileHigh,
            CodecProfileLevel.AVCProfileConstrainedHigh -> "High"
            CodecProfileLevel.AVCProfileHigh10 -> "High 10"
            CodecProfileLevel.AVCProfileHigh422 -> "High 4:2:2"
            CodecProfileLevel.AVCProfileHigh444 -> "High 4:4:4 Predictive"
            else -> null
          }
        "video/hevc" ->
          when (profile) {
            CodecProfileLevel.HEVCProfileMain -> "Main"
            CodecProfileLevel.HEVCProfileMain10,
            CodecProfileLevel.HEVCProfileMain10HDR10,
            CodecProfileLevel.HEVCProfileMain10HDR10Plus -> "Main 10"
            else -> null
          }
        "video/mpeg2" ->
          when (profile) {
            CodecProfileLevel.MPEG2ProfileSimple -> "Simple"
            CodecProfileLevel.MPEG2ProfileMain -> "Main"
            CodecProfileLevel.MPEG2Profile422 -> "4:2:2"
            CodecProfileLevel.MPEG2ProfileHigh -> "High"
            else -> null
          }
        else -> null
      }
  }
}
