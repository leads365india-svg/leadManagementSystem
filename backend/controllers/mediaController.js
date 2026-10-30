const mongoose = require("mongoose")
const MediaFile = require("../models/MediaFile")
const Lead = require("../models/Lead")
const User = require("../models/User")
const Account = require("../models/Account")
const Call = require("../models/Call")
const mediaStorage = require("../services/mediaStorage.service")
const audit = require("../services/auditService")

/**
 * Media Controller
 * 
 * REST API controller for centralized cloud media management (ImageKit):
 * - Document, PDF, and image uploads with tenant isolation.
 * - Profile images, company logos, and lead/call attachments.
 * - Authenticated signed URL generation and private streaming.
 * - Secure deletion with tenant ownership verification.
 */

/**
 * POST /api/media/upload
 * Upload a media file to ImageKit and persist metadata to MongoDB.
 */
async function uploadMedia(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file was uploaded.",
        code: "NO_FILE_PROVIDED",
      })
    }

    const tenantId = req.tenantId || req.user?.tenantId
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: "Tenant context is required for media upload.",
        code: "MISSING_TENANT_ID",
      })
    }

    const category = req.body.category || "general"
    const isPrivate = req.body.isPrivate !== "false" && req.body.isPrivate !== false
    const relatedEntityType = req.body.relatedEntityType || "None"
    const rawRelatedId = req.body.relatedEntityId || null
    const relatedEntityId = rawRelatedId && mongoose.Types.ObjectId.isValid(rawRelatedId)
      ? new mongoose.Types.ObjectId(rawRelatedId)
      : null

    // Validate file with category rules
    const validation = mediaStorage.validateFile({
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      category,
    })

    if (!validation.valid) {
      return res.status(validation.code === "FILE_TOO_LARGE" ? 413 : 415).json({
        success: false,
        error: validation.error,
        code: validation.code,
      })
    }

    // Verify related entity belongs to the tenant if specified
    if (relatedEntityId && relatedEntityType === "Lead") {
      const lead = await Lead.findOne({ _id: relatedEntityId, tenantId }).setOptions({ skipTenantFilter: true }).lean()
      if (!lead) {
        return res.status(404).json({
          success: false,
          error: "Related lead not found or belongs to another tenant.",
          code: "RELATED_LEAD_NOT_FOUND",
        })
      }
    } else if (relatedEntityId && relatedEntityType === "Call") {
      const call = await Call.findOne({ _id: relatedEntityId, tenantId }).setOptions({ skipTenantFilter: true }).lean()
      if (!call) {
        return res.status(404).json({
          success: false,
          error: "Related call not found or belongs to another tenant.",
          code: "RELATED_CALL_NOT_FOUND",
        })
      }
    }

    // Handle upload via mediaStorage (supports ImageKit with fallback)
    let uploadResult = null
    if (mediaStorage.isImageKitConfigured()) {
      uploadResult = await mediaStorage.uploadFile({
        file: req.file.buffer,
        fileName: req.file.originalname,
        tenantId,
        category,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        tags: [category, String(tenantId)],
        customMetadata: {
          uploadedBy: String(req.user?._id || "system"),
          relatedEntityType,
          relatedEntityId: relatedEntityId ? String(relatedEntityId) : null,
        },
      })
    } else {
      // Mock / fallback storage reference when ImageKit credentials not yet entered
      const mockFileId = `local_media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      uploadResult = {
        success: true,
        provider: "local",
        fileId: mockFileId,
        fileName: req.file.originalname,
        filePath: `/lead-management/${tenantId}/${category}/${req.file.originalname}`,
        url: `/api/media/${mockFileId}/stream`,
        sizeBytes: req.file.size,
        mimeType: req.file.mimetype,
      }
    }

    // Persist MediaFile record in MongoDB
    const mediaFile = await MediaFile.create({
      tenantId,
      provider: uploadResult.provider || "imagekit",
      fileId: uploadResult.fileId,
      fileName: uploadResult.fileName || req.file.originalname,
      originalName: req.file.originalname,
      filePath: uploadResult.filePath || "",
      folder: `/lead-management/${tenantId}/${category}/`,
      url: uploadResult.url || "",
      thumbnailUrl: uploadResult.thumbnailUrl || null,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      category,
      relatedEntity: {
        entityType: relatedEntityType,
        entityId: relatedEntityId,
      },
      uploadedBy: req.user?._id || null,
      uploadStatus: "stored",
      isPrivate,
    })

    // Update parent entity references where applicable
    if (category === "profile-images" && req.user?._id && relatedEntityType === "User") {
      await User.updateOne({ _id: req.user._id }, { $set: { avatarUrl: uploadResult.url } }).catch(() => {})
    } else if (category === "profile-images" && relatedEntityType === "Account") {
      await Account.updateOne({ tenantId }, { $set: { logoUrl: uploadResult.url } }).catch(() => {})
    }

    // Audit upload
    if (audit && typeof audit.log === "function") {
      audit.log({
        tenantId,
        action: "media.upload",
        category: "media",
        entity: "MediaFile",
        entityId: mediaFile._id,
        actor: req.user || { _id: "system", name: "System User", role: "agent" },
        target: { type: relatedEntityType, id: relatedEntityId || mediaFile._id },
        details: {
          category,
          sizeBytes: req.file.size,
          mimeType: req.file.mimetype,
          fileId: uploadResult.fileId,
        },
      }).catch(() => {})
    }

    return res.status(201).json({
      success: true,
      message: "Media uploaded successfully",
      media: {
        id: mediaFile._id,
        fileId: mediaFile.fileId,
        fileName: mediaFile.fileName,
        originalName: mediaFile.originalName,
        url: mediaFile.url,
        thumbnailUrl: mediaFile.thumbnailUrl,
        category: mediaFile.category,
        mimeType: mediaFile.mimeType,
        sizeBytes: mediaFile.sizeBytes,
        uploadedAt: mediaFile.createdAt,
      },
    })
  } catch (error) {
    console.error("[MediaController Upload Error]:", error.message)
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "Failed to upload media file",
      code: error.code || "MEDIA_UPLOAD_FAILED",
    })
  }
}

/**
 * GET /api/media/:mediaId
 * Get metadata for a specific media file.
 */
async function getMediaDetails(req, res) {
  try {
    const { mediaId } = req.params
    const tenantId = req.tenantId || req.user?.tenantId
    const isSuperAdmin = req.user?.role === "super_admin"

    const query = {
      $or: [
        { fileId: mediaId },
        ...(mongoose.Types.ObjectId.isValid(mediaId) ? [{ _id: mediaId }] : []),
      ],
    }
    if (!isSuperAdmin) {
      query.tenantId = tenantId
    }

    const media = await MediaFile.findOne(query).setOptions({ skipTenantFilter: true }).lean()
    if (!media) {
      return res.status(404).json({
        success: false,
        error: "Media file not found",
        code: "MEDIA_NOT_FOUND",
      })
    }

    return res.status(200).json({
      success: true,
      media,
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to retrieve media details",
      code: "MEDIA_RETRIEVAL_FAILED",
    })
  }
}

/**
 * GET /api/media/:mediaId/signed-url
 * Generate an authenticated short-lived signed URL for private media delivery.
 */
async function getMediaSignedUrl(req, res) {
  try {
    const { mediaId } = req.params
    const tenantId = req.tenantId || req.user?.tenantId
    const isSuperAdmin = req.user?.role === "super_admin"

    const query = {
      $or: [
        { fileId: mediaId },
        ...(mongoose.Types.ObjectId.isValid(mediaId) ? [{ _id: mediaId }] : []),
      ],
    }
    if (!isSuperAdmin) {
      query.tenantId = tenantId
    }

    const media = await MediaFile.findOne(query).setOptions({ skipTenantFilter: true }).lean()
    if (!media) {
      return res.status(404).json({
        success: false,
        error: "Media file not found or unauthorized",
        code: "MEDIA_NOT_FOUND",
      })
    }

    if (!mediaStorage.isImageKitConfigured()) {
      return res.status(200).json({
        success: true,
        url: media.url,
        expiresInSeconds: 300,
      })
    }

    const signedUrl = mediaStorage.generatePrivateFileUrl({
      path: media.filePath,
      url: media.url,
      expireSeconds: 300,
    })

    return res.status(200).json({
      success: true,
      url: signedUrl,
      expiresInSeconds: 300,
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to generate signed URL",
      code: "SIGNED_URL_FAILED",
    })
  }
}

/**
 * DELETE /api/media/:mediaId
 * Securely deletes media from ImageKit and database with tenant verification.
 */
async function deleteMedia(req, res) {
  try {
    const { mediaId } = req.params
    const tenantId = req.tenantId || req.user?.tenantId
    const isSuperAdmin = req.user?.role === "super_admin"

    const query = {
      $or: [
        { fileId: mediaId },
        ...(mongoose.Types.ObjectId.isValid(mediaId) ? [{ _id: mediaId }] : []),
      ],
    }
    if (!isSuperAdmin) {
      query.tenantId = tenantId
    }

    const media = await MediaFile.findOne(query).setOptions({ skipTenantFilter: true })
    if (!media) {
      return res.status(404).json({
        success: false,
        error: "Media file not found or unauthorized",
        code: "MEDIA_NOT_FOUND",
      })
    }

    // Delete from ImageKit if configured
    if (mediaStorage.isImageKitConfigured() && media.fileId) {
      try {
        await mediaStorage.deleteFile(media.fileId, media.tenantId)
      } catch (delErr) {
        console.warn("[MediaController] ImageKit remote delete notice:", delErr.message)
      }
    }

    await MediaFile.deleteOne({ _id: media._id }).setOptions({ skipTenantFilter: true })

    // Audit deletion
    if (audit && typeof audit.log === "function") {
      audit.log({
        tenantId,
        action: "media.delete",
        category: "media",
        entity: "MediaFile",
        entityId: media._id,
        actor: req.user || { _id: "system", name: "System User", role: "agent" },
        target: { type: media.category, id: media._id },
        details: {
          fileId: media.fileId,
          fileName: media.fileName,
        },
      }).catch(() => {})
    }

    return res.status(200).json({
      success: true,
      message: "Media deleted successfully",
      mediaId: media._id,
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to delete media file",
      code: "MEDIA_DELETE_FAILED",
    })
  }
}

/**
 * GET /api/media/lead/:leadId
 * List all media files attached to a lead.
 */
async function getLeadMedia(req, res) {
  try {
    const { leadId } = req.params
    const tenantId = req.tenantId || req.user?.tenantId
    const isSuperAdmin = req.user?.role === "super_admin"

    if (!mongoose.Types.ObjectId.isValid(leadId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid lead ID format",
        code: "INVALID_LEAD_ID",
      })
    }

    const query = {
      "relatedEntity.entityType": "Lead",
      "relatedEntity.entityId": new mongoose.Types.ObjectId(leadId),
    }
    if (!isSuperAdmin) {
      query.tenantId = tenantId
    }

    const files = await MediaFile.find(query)
      .sort({ createdAt: -1 })
      .setOptions({ skipTenantFilter: true })
      .lean()

    return res.status(200).json({
      success: true,
      media: files,
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch lead media",
      code: "LEAD_MEDIA_FETCH_FAILED",
    })
  }
}

module.exports = {
  uploadMedia,
  getMediaDetails,
  getMediaSignedUrl,
  deleteMedia,
  getLeadMedia,
}

