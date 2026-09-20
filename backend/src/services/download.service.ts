import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DownloadRecord, type DownloadRecordDocument } from '../models/downloadRecord.schema';
import { AssetService } from './asset.service';
import { LicenseService } from './license.service';
import { AssetStatus, DownloadPurpose, LicenseType, UserRole } from '../types/enums';
import type { AuthUser } from '../types/interfaces';

@Injectable()
export class DownloadService {
  constructor(
    @InjectModel(DownloadRecord.name) private readonly downloadModel: Model<DownloadRecordDocument>,
    private readonly assetService: AssetService,
    private readonly licenseService: LicenseService,
  ) {}

  findAll() {
    return this.downloadModel.find().sort({ downloadedAt: -1 }).exec();
  }

  async create(assetId: string, user: AuthUser, purpose: DownloadPurpose) {
    const asset = await this.assetService.findOne(assetId);
    if (!asset) throw new NotFoundException('素材不存在');
    const commercialOnly = [LicenseType.Commercial, LicenseType.Extended].includes(asset.licenseType);
    if (commercialOnly && user.role === UserRole.Viewer && !user.canDownloadCommercial) {
      throw new ForbiddenException('Commercial 许可素材需要额外权限');
    }
    await this.assetService.incrementDownload(assetId);
    return this.downloadModel.create({
      assetId: new Types.ObjectId(assetId),
      downloaderId: user.id,
      purpose,
      licenseVersion: `${asset.licenseType}-2026.1`,
    });
  }

  /** 持码下载：先校验素材状态，再原子核销许可，任一失败均不增加下载量 */
  async redeemWithLicense(assetId: string, user: AuthUser, code: string, purpose: DownloadPurpose) {
    if (!code) throw new BadRequestException('许可码不能为空');
    const asset = await this.assetService.getById(assetId);
    if (asset.status !== AssetStatus.Published) {
      throw new ForbiddenException('素材未发布或已归档，许可下载被拒绝');
    }
    const grant = await this.licenseService.redeem(code, assetId, purpose, user.id);
    await this.assetService.incrementDownload(assetId);
    return this.downloadModel.create({
      assetId: new Types.ObjectId(assetId),
      downloaderId: user.id,
      purpose,
      licenseVersion: grant.licenseVersion,
      grantCode: grant.code,
    });
  }
}
