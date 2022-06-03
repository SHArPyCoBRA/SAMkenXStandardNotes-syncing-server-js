import { inject, injectable } from 'inversify'
import { RoleName, ContentType } from '@standardnotes/common'
import { TimerInterface } from '@standardnotes/time'

import TYPES from '../../Bootstrap/Types'
import { Item } from '../Item/Item'
import { Revision } from './Revision'
import { RevisionRepositoryInterface } from './RevisionRepositoryInterface'
import { RevisionServiceInterface } from './RevisionServiceInterface'
import { ItemRepositoryInterface } from '../Item/ItemRepositoryInterface'

@injectable()
export class RevisionService implements RevisionServiceInterface {
  constructor(
    @inject(TYPES.RevisionRepository) private revisionRepository: RevisionRepositoryInterface,
    @inject(TYPES.ItemRepository) private itemRepository: ItemRepositoryInterface,
    @inject(TYPES.Timer) private timer: TimerInterface,
  ) {}

  async removeRevision(dto: { userUuid: string; itemUuid: string; revisionUuid: string }): Promise<boolean> {
    const userItem = await this.itemRepository.findByUuid(dto.itemUuid)
    if (userItem === null || userItem.userUuid !== dto.userUuid) {
      return false
    }

    await this.revisionRepository.removeByUuid(dto.itemUuid, dto.revisionUuid)

    return true
  }

  async getRevisions(userUuid: string, itemUuid: string): Promise<Revision[]> {
    const userItem = await this.itemRepository.findByUuid(itemUuid)
    if (userItem === null || userItem.userUuid !== userUuid) {
      return []
    }

    const revisions = await this.revisionRepository.findByItemId({ itemUuid })

    return revisions
  }

  async getRevision(dto: {
    userUuid: string
    userRoles: RoleName[]
    itemUuid: string
    revisionUuid: string
  }): Promise<Revision | null> {
    const userItem = await this.itemRepository.findByUuid(dto.itemUuid)
    if (userItem === null || userItem.userUuid !== dto.userUuid) {
      return null
    }

    const revision = await this.revisionRepository.findOneById(dto.itemUuid, dto.revisionUuid)

    if (revision !== null && !this.userHasEnoughPermissionsToSeeRevision(dto.userRoles, revision.createdAt)) {
      return null
    }

    return revision
  }

  async copyRevisions(fromItemUuid: string, toItemUuid: string): Promise<void> {
    const revisions = await this.revisionRepository.findByItemId({
      itemUuid: fromItemUuid,
    })

    const toItem = await this.itemRepository.findByUuid(toItemUuid)
    if (toItem === null) {
      throw Error(`Item ${toItemUuid} does not exist`)
    }

    for (const existingRevision of revisions) {
      const revisionCopy = new Revision()
      revisionCopy.authHash = existingRevision.authHash
      revisionCopy.content = existingRevision.content
      revisionCopy.contentType = existingRevision.contentType
      revisionCopy.encItemKey = existingRevision.encItemKey
      revisionCopy.item = Promise.resolve(toItem)
      revisionCopy.itemsKeyId = existingRevision.itemsKeyId
      revisionCopy.creationDate = existingRevision.creationDate
      revisionCopy.createdAt = existingRevision.createdAt
      revisionCopy.updatedAt = existingRevision.updatedAt

      await this.revisionRepository.save(revisionCopy)
    }
  }

  async createRevision(item: Item): Promise<void> {
    if (![ContentType.Note, ContentType.File].includes(item.contentType as ContentType)) {
      return
    }

    const now = new Date()

    const revision = new Revision()
    revision.authHash = item.authHash
    revision.content = item.content
    revision.contentType = item.contentType
    revision.encItemKey = item.encItemKey
    revision.item = Promise.resolve(item)
    revision.itemsKeyId = item.itemsKeyId
    revision.creationDate = now
    revision.createdAt = now
    revision.updatedAt = now

    await this.revisionRepository.save(revision)
  }

  calculateRequiredRoleBasedOnRevisionDate(createdAt: Date): RoleName {
    const revisionCreatedNDaysAgo = this.timer.dateWasNDaysAgo(createdAt)

    if (revisionCreatedNDaysAgo > 30 && revisionCreatedNDaysAgo < 365) {
      return RoleName.PlusUser
    }

    if (revisionCreatedNDaysAgo > 365) {
      return RoleName.ProUser
    }

    return RoleName.CoreUser
  }

  private userHasEnoughPermissionsToSeeRevision(userRoles: RoleName[], revisionCreatedAt: Date): boolean {
    const roleRequired = this.calculateRequiredRoleBasedOnRevisionDate(revisionCreatedAt)

    switch (roleRequired) {
      case RoleName.PlusUser:
        return userRoles.filter((userRole) => [RoleName.PlusUser, RoleName.ProUser].includes(userRole)).length > 0
      case RoleName.ProUser:
        return userRoles.includes(RoleName.ProUser)
      default:
        return true
    }
  }
}
