"""Metadata-only filtering of a carrier library through its canonical ID crosswalk."""
from analysis_membership import MembershipFilterError


def membership_for(owner, library):
    return getattr(owner, "pinned_memberships", {}).get(library) or getattr(owner, "membership", None)


class PinnedSubsetMembership:
    def __init__(self, membership, rule, crosswalk):
        self.source = membership
        self.rule = dict(rule)
        self.crosswalk = {int(key): int(value) for key, value in crosswalk.items()}
        if len(set(self.crosswalk.values())) != len(self.crosswalk):
            raise ValueError("Pinned subset crosswalk must be one-to-one")
        self.reverse = {value: key for key, value in self.crosswalk.items()}
        self.libraries = {rule["carrier_library"]: {}}
        self.database = membership.database

    def normalize(self, library, value):
        if library not in self.libraries or not isinstance(value, dict):
            raise MembershipFilterError("Invalid pinned collection filters")
        field, fixed = self.rule["scope_field"], self.rule["scope_value"]
        for key, selected in value.items():
            if key not in {field, "include_controls", "species", "source_organisms", "record_ids"} and selected not in (None, False, [], {}):
                raise MembershipFilterError("Only species and organism refinements are supported within this collection")
        if value.get("include_controls") not in (None, False):
            raise MembershipFilterError("Controls are unavailable in this collection")
        if field in value and value[field] != [fixed]:
            raise MembershipFilterError("The pinned source collection cannot be changed")
        requested = {field: [fixed], "include_controls": False}
        for name in ("species", "source_organisms", "record_ids"):
            if name in value:
                requested[name] = value[name]
        return self.source.normalize(self.rule["library"], requested)

    def allowed_ids(self, library, identifiers, filters):
        normalized = self.normalize(library, filters)
        originals = {self.reverse[int(value)] for value in identifiers if int(value) in self.reverse}
        accepted = self.source.allowed_ids(self.rule["library"], originals, normalized)
        return {self.crosswalk[value] for value in accepted}

    def catalog_subset_ids(self, library, filters):
        return sorted(self.allowed_ids(library, self.reverse, filters))

    def row_filter_columns(self, library):
        # Package rows keep their existing IDs and bytes. Exact masks express the
        # canonical membership decision after mapping those IDs to the carrier.
        return {}
