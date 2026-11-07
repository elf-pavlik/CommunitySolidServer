import type { AuxiliaryStrategy } from '../http/auxiliary/AuxiliaryStrategy';
import type { RepresentationMetadata } from '../http/representation/RepresentationMetadata';
import type { ResourceIdentifier } from '../http/representation/ResourceIdentifier';
import type { StorageLocationStrategy } from '../server/description/StorageLocationStrategy';
import type { IdentifierStrategy } from '../util/identifiers/IdentifierStrategy';
import { RDF } from '../util/Vocabularies';
import type { DataAccessor } from './accessors/DataAccessor';
import { DataAccessorBasedStore } from './DataAccessorBasedStore';

/**
 * A {@link DataAccessorBasedStore} that allocates every resource created through
 * {@link DataAccessorBasedStore.addResource} directly under its storage root, using a UUID as identifier.
 *
 * LWS, §Resource Identification: "The URI of a resource is independent of its position in the containment hierarchy.
 * Servers assign URIs during resource creation and MAY incorporate client hints, but clients SHOULD NOT assume
 * that URI structure reflects containment."
 * Identifiers never end in a slash, not even for containers. Container types are stored as metadata.
 *
 * Containment is stored as `lws:contains` metadata on the parent container,
 * and the parent of a resource is stored as `lws:partOf` metadata on the resource,
 * so none of the resource operations on these resources rely on slash semantics.
 * Slugs are ignored: the server always allocates `{storageRoot}{uuid}` for these resources.
 *
 * Resources that are generated during pod or account initialization keep their explicit identifiers,
 * as those identifiers are part of the Solid data model.
 */
export class FlatDataAccessorBasedStore extends DataAccessorBasedStore {
  private readonly storageStrategy: StorageLocationStrategy;

  /**
   * @param accessor - Backend used to store the resources.
   * @param identifierStrategy - Strategy used to validate identifiers.
   * @param auxiliaryStrategy - Strategy used to determine auxiliary resources.
   * @param metadataStrategy - Strategy used to determine metadata resources.
   * @param storageStrategy - Strategy used to determine the storage root of a container.
   */
  public constructor(
    accessor: DataAccessor,
    identifierStrategy: IdentifierStrategy,
    auxiliaryStrategy: AuxiliaryStrategy,
    metadataStrategy: AuxiliaryStrategy,
    storageStrategy: StorageLocationStrategy,
  ) {
    super(accessor, identifierStrategy, auxiliaryStrategy, metadataStrategy);
    this.storageStrategy = storageStrategy;
  }

  protected override storesContainmentMetadata(): boolean {
    return true;
  }

  /**
   * Containers are identified by their metadata, since flat identifiers have no trailing slash.
   */
  protected override isContainer(identifier: ResourceIdentifier, metadata?: RepresentationMetadata): boolean {
    return Boolean(metadata && this.hasContainerType(metadata.getAll(RDF.terms.type))) ||
      super.isContainer(identifier, metadata);
  }

  /**
   * Allocates a UUID directly under the storage root.
   * The container only determines the storage, not the identifier.
   */
  protected override async createIdentifier(container: ResourceIdentifier): Promise<ResourceIdentifier> {
    const storage = await this.storageStrategy.getStorageIdentifier(container);
    // The slug is intentionally ignored, so clients can not influence the allocated URI.
    // Containers also get an identifier without a trailing slash.
    return this.createURI(storage, false);
  }
}
