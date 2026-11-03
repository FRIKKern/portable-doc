# Releasing `@portable-doc/react`

The `PortableDoc React release` workflow always builds, smoke-tests, verifies,
and dry-runs publication of the exact `1.0.0` tarball. Its `publish` input is
`false` by default.

Publishing additionally requires all of these owner-controlled gates:

- the dispatch is from `main` with `publish: true` and the reviewed tarball's
  exact SHA-256 in `approved_sha256`;
- the protected `portable-doc-react-release` environment approves the job;
- that environment defines `PORTABLE_DOC_REACT_PUBLISH_ENABLED=true`; and
- npm trusted publishing authorizes this repository and workflow.

The registry currently has no `@portable-doc/react` package. An npm scope owner
must bootstrap it before the workflow can publish. One option is npm staged
publishing: `npm stage publish` creates the public `0.0.0-stage` placeholder,
then an owner reviews the exact staged tarball and approves it with 2FA. Do not
stage or approve from automation in this repository.

Create the trusted-publisher configuration only when the first real release is
ready. npm expires a new configuration if it does not complete a successful
validation within two days. Creating the environment, setting its variable,
configuring npm, staging, approving, and publishing are deliberately outside
this release-preparation change.

References:

- <https://docs.npmjs.com/staged-publishing/>
- <https://docs.npmjs.com/trusted-publishers/>
