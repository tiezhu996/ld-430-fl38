import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import { LicenseGrant, type LicenseGrantDocument } from '../models/licenseGrant.schema';
import { DownloadPurpose, LicenseGrantStatus, LicenseType, UserRole } from '../types/enums';
import type { AuthUser } from '../types/interfaces';
import { AssetService } from './asset.service';

const GRANT_TTL_MS = 24 * 60 * 60 * 1000; // 许可自签发起 24 小时有效
const COMMERCIAL_LICENSES: LicenseType[] = [LicenseType.Commercial, LicenseType.Extended];

@Injectable()
export class LicenseService {
  constructor(
    @InjectModel(LicenseGrant.name) private readonly licenseModel: Model<LicenseGrantDocument>,
    private readonly assetService: AssetService,
  ) {}

  findAll(query: { assetId?: string; code?: string; status?: LicenseGrantStatus }) {
    const filter: Record<string, unknown> = {};
    if (query.assetId) filter.assetId = new Types.ObjectId(query.assetId);
    if (query.code) filter.code = query.code;
    if (query.status) filter.status = query.status;
    return this.licenseModel.find(filter).sort({ issuedAt: -1 }).exec();
  }

  async findByCode(code: string) {
    const grant = await this.licenseModel.findOne({ code }).exec();
    if (!grant) throw new NotFoundException('许可不存在');
    return grant;
  }

  async issue(assetId: string, user: AuthUser, purpose: DownloadPurpose, granteeId?: string) {
    const asset = await this.assetService.getById(assetId);
    if (!COMMERCIAL_LICENSES.includes(asset.licenseType)) {
      throw new BadRequestException('仅 Commercial/Extended 素材需要签发下载许可');
    }
    const privileged = user.role === UserRole.Admin || user.role === UserRole.Moderator;
    if (!privileged && asset.uploaderId !== user.id) {
      throw new ForbiddenException('仅管理员、审核员或素材上传者可签发许可');
    }
    const grantee = granteeId ?? user.id;
    const now = new Date();
    // 已过期但仍占位的 Active 许可先落库为 Expired，释放唯一槽位
    await this.licenseModel.updateMany(
      { assetId: asset._id, granteeId: grantee, status: LicenseGrantStatus.Active, expiresAt: { $lte: now } },
      { $set: { status: LicenseGrantStatus.Expired } },
    );
    const existing = await this.licenseModel
      .findOne({ assetId: asset._id, granteeId: grantee, status: LicenseGrantStatus.Active })
      .exec();
    if (existing) return existing; // 重复签发幂等返回，不产生第二张有效许可
    try {
      return await this.licenseModel.create({
        assetId: asset._id,
        code: `LIC-${randomBytes(8).toString('hex').toUpperCase()}`,
        granteeId: grantee,
        issuedBy: user.id,
        purpose,
        licenseVersion: `${asset.licenseType}-2026.1`,
        status: LicenseGrantStatus.Active,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + GRANT_TTL_MS),
      });
    } catch (err) {
      // 并发签发由部分唯一索引兜底：竞争失败方回读胜出记录，保证只有一张生效
      if ((err as { code?: number }).code === 11000) {
        const winner = await this.licenseModel
          .findOne({ assetId: asset._id, granteeId: grantee, status: LicenseGrantStatus.Active })
          .exec();
        if (winner) return winner;
      }
      throw err;
    }
  }

  async revoke(code: string, user: AuthUser) {
    const grant = await this.findByCode(code);
    if (grant.status === LicenseGrantStatus.Revoked) return grant; // 重复撤销幂等返回
    const asset = await this.assetService.getById(grant.assetId.toString());
    const privileged = user.role === UserRole.Admin || user.role === UserRole.Moderator;
    if (!privileged && grant.issuedBy !== user.id && asset.uploaderId !== user.id) {
      throw new ForbiddenException('仅管理员、审核员或素材上传者可撤销许可');
    }
    const updated = await this.licenseModel
      .findOneAndUpdate(
        { code, status: LicenseGrantStatus.Active },
        { $set: { status: LicenseGrantStatus.Revoked, revokedAt: new Date(), revokedBy: user.id } },
        { new: true },
      )
      .exec();
    if (!updated) throw new ConflictException('许可已使用或已过期，无法撤销');
    return updated;
  }

  /** 原子核销：仅 Active 且未过期、归属与用途均匹配的许可可被消费，并发下只有一方生效 */
  async redeem(code: string, assetId: string, purpose: DownloadPurpose, userId: string) {
    const now = new Date();
    const grant = await this.licenseModel
      .findOneAndUpdate(
        {
          code,
          assetId: new Types.ObjectId(assetId),
          granteeId: userId,
          purpose,
          status: LicenseGrantStatus.Active,
          expiresAt: { $gt: now },
        },
        { $set: { status: LicenseGrantStatus.Used, usedAt: now } },
        { new: true },
      )
      .exec();
    if (grant) return grant;
    const existing = await this.licenseModel.findOne({ code }).exec();
    if (!existing) throw new NotFoundException('许可码不存在');
    if (existing.status === LicenseGrantStatus.Revoked) throw new ForbiddenException('许可已撤销');
    if (existing.status === LicenseGrantStatus.Used) throw new ForbiddenException('许可已被使用');
    if (existing.status === LicenseGrantStatus.Expired || existing.expiresAt <= now) {
      throw new ForbiddenException('许可已过期');
    }
    if (existing.assetId.toString() !== assetId) throw new BadRequestException('许可与素材不匹配');
    if (existing.granteeId !== userId) throw new ForbiddenException('许可不属于当前用户');
    if (existing.purpose !== purpose) throw new BadRequestException('下载用途与许可不一致');
    throw new ForbiddenException('许可不可用');
  }
}
