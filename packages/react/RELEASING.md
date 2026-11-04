# Releasing `@portable-doc/react`

The `PortableDoc React release` workflow always builds, smoke-tests, verifies,
and dry-runs publication of the exact `0.1.0-alpha.1` tarball. Its `publish` input is
`false` by default.

Publishing additionally requires all of these owner-controlled gates:

- the dispatch is from `main` with `publish: true` and the reviewed tarball's
  exact SHA-256 in `approved_sha256`;
- the protected `portable-doc-react-release` environment approves the job;
- that environment defines `PORTABLE_DOC_REACT_PUBLISH_ENABLED=true`; and
- npm trusted publishing authorizes this repository and workflow.

### First release

The npm scope owner handles bootstrap and 2FA. When the package name is new,
the owner can reserve it by staging the exact tarball from the reviewed GitHub
Actions run with an explicit prerelease tag.

```sh
npm stage publish ./portable-doc-react-0.1.0-alpha.1.tgz --access public --tag alpha
```

This creates a public `0.0.0-stage` placeholder and reserves the alpha version
in the staging queue. In the placeholder's npm settings, configure trusted
publishing for `FRIKKern/portable-doc`, workflow
`portable-doc-react-release.yml`, environment `portable-doc-react-release`.
Create that GitHub environment with the owner approval and publish variable
described above.

For the first release with CI provenance, the owner rejects the bootstrap
staging entry with 2FA to free the alpha version. Verify the package and its
trusted publisher are still present in npm settings and the staging queue no
longer contains the alpha before dispatching the protected workflow. Approving
the bootstrap entry would publish it immediately and consume the version.

Configure trust when the protected workflow is ready to run. npm expires a new
configuration if it does not complete a successful validation within two days.

References:

- <https://docs.npmjs.com/staged-publishing/>
- <https://docs.npmjs.com/trusted-publishers/>
