import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import { LicenseGrant, type LicenseGrantDocument } from '../models/licenseGrant.schema';
import { AssetStatus, DownloadPurpose, LicenseStatus, LicenseType, UserRole } from '../types/enums';
import type { AuthUser } from '../types/interfaces';
import { AssetService } from './asset.service';

const LICENSE_TTL_MS = 24 * 60 * 60 * 1000; // 许可一次有效，24 小时过期

@Injectable()
export class LicenseService {
  constructor(
    @InjectModel(LicenseGrant.name) private readonly licenseModel: Model<LicenseGrantDocument>,
    private readonly assetService: AssetService,
  ) {}

  findAll(query: { assetId?: string; grantedTo?: string; status?: LicenseStatus }) {
    const filter: Record<string, unknown> = {};
    if (query.assetId) filter.assetId = new Types.ObjectId(query.assetId);
    if (query.grantedTo) filter.grantedTo = query.grantedTo;
    if (query.status) filter.status = query.status;
    return this.licenseModel.find(filter).sort({ issuedAt: -1 }).exec();
  }

  async findByCode(code: string) {
    const license = await this.licenseModel.findOne({ code }).exec();
    if (!license) throw new NotFoundException('许可不存在');
    return license;
  }

  async issue(assetId: string, issuer: AuthUser, payload: { grantedTo?: string; purpose?: DownloadPurpose }) {
    const asset = await this.assetService.findById(assetId);
    if (!asset) throw new NotFoundException('素材不存在');
    if (![LicenseType.Commercial, LicenseType.Extended].includes(asset.licenseType)) {
      throw new BadRequestException('仅 Commercial/Extended 素材需要签发下载许可');
    }
    if (asset.status === AssetStatus.Archived) throw new BadRequestException('素材已归档，无法签发许可');
    const privileged = [UserRole.Admin, UserRole.Moderator].includes(issuer.role);
    if (!privileged && asset.uploaderId !== issuer.id) {
      throw new ForbiddenException('仅管理员、审核员或素材上传者可签发许可');
    }
    const grantedTo = payload.grantedTo ?? issuer.id;
    const now = new Date();
    // 幂等：已存在未过期的 Active 许可时直接返回，不重复签发
    const existing = await this.licenseModel
      .findOne({ assetId: new Types.ObjectId(assetId), grantedTo, status: LicenseStatus.Active, expiresAt: { $gt: now } })
      .exec();
    if (existing) return existing;
    try {
      return await this.licenseModel.create({
        assetId: new Types.ObjectId(assetId),
        code: randomBytes(16).toString('hex'),
        grantedTo,
        grantedBy: issuer.id,
        purpose: payload.purpose ?? DownloadPurpose.Commercial,
        status: LicenseStatus.Active,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + LICENSE_TTL_MS),
      });
    } catch (err) {
      // 并发签发命中 (assetId, grantedTo) 唯一索引时，回读已存在的那一条
      if ((err as { code?: number })?.code === 11000) {
        const dup = await this.licenseModel
          .findOne({ assetId: new Types.ObjectId(assetId), grantedTo, status: LicenseStatus.Active })
          .exec();
        if (dup) return dup;
      }
      throw err;
    }
  }

  async revoke(code: string, user: AuthUser) {
    const license = await this.findByCode(code);
    const asset = await this.assetService.findById(license.assetId.toString());
    const privileged = [UserRole.Admin, UserRole.Moderator].includes(user.role);
    if (!privileged && asset?.uploaderId !== user.id && license.grantedBy !== user.id) {
      throw new ForbiddenException('仅管理员、审核员、上传者或签发人可撤销许可');
    }
    const revoked = await this.licenseModel
      .findOneAndUpdate(
        { _id: license._id, status: LicenseStatus.Active },
        { $set: { status: LicenseStatus.Revoked, revokedAt: new Date(), revokedBy: user.id } },
        { new: true },
      )
      .exec();
    if (revoked) return revoked;
    const fresh = await this.licenseModel.findById(license._id).exec();
    if (fresh?.status === LicenseStatus.Revoked) return fresh; // 重复/并发撤销幂等返回
    throw new BadRequestException('许可已使用或已过期，无法撤销');
  }

  /** 核销许可：校验许可、素材状态与用途，全部通过才原子置为 Used，否则抛错且不影响下载量 */
  async redeem(code: string, assetId: string, user: AuthUser, purpose: DownloadPurpose) {
    const license = await this.licenseModel.findOne({ code }).exec();
    if (!license) throw new NotFoundException('许可不存在');
    if (license.assetId.toString() !== assetId) throw new BadRequestException('许可与素材不匹配');
    if (license.grantedTo !== user.id && user.role !== UserRole.Admin) {
      throw new ForbiddenException('许可不属于当前用户');
    }
    if (license.purpose !== purpose) throw new BadRequestException('下载用途与许可用途不符');
    const asset = await this.assetService.findById(assetId);
    if (!asset) throw new NotFoundException('素材不存在');
    if (asset.status !== AssetStatus.Published) throw new ForbiddenException('素材已归档或未发布，许可不可用');
    const now = new Date();
    const consumed = await this.licenseModel
      .findOneAndUpdate(
        { _id: license._id, status: LicenseStatus.Active, expiresAt: { $gt: now } },
        { $set: { status: LicenseStatus.Used, usedAt: now } },
        { new: true },
      )
      .exec();
    if (consumed) return consumed;
    const fresh = await this.licenseModel.findById(license._id).exec();
    if (fresh?.status === LicenseStatus.Revoked) throw new ForbiddenException('许可已撤销');
    if (fresh?.status === LicenseStatus.Used) throw new ForbiddenException('许可已使用，仅可下载一次');
    if (fresh && fresh.expiresAt <= now) {
      await this.licenseModel
        .updateOne({ _id: license._id, status: LicenseStatus.Active }, { $set: { status: LicenseStatus.Expired } })
        .exec();
      throw new ForbiddenException('许可已过期');
    }
    throw new ForbiddenException('许可不可用');
  }
}
