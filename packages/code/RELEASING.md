# Releasing `@portable-doc/code`

The `PortableDoc code release` workflow always builds, tests, smoke-tests,
verifies, and dry-runs publication of the exact
`portable-doc-code-0.1.0-alpha.1.tgz` tarball. Its `publish` input is `false` by
default.

Publishing additionally requires all of these owner-controlled gates:

- the dispatch is from `main` with `publish: true` and the reviewed tarball's
  exact SHA-256 in `approved_sha256`;
- the protected `portable-doc-code-release` environment approves the job;
- that environment defines `PORTABLE_DOC_CODE_PUBLISH_ENABLED=true`; and
- npm trusted publishing authorizes this repository and workflow.

The registry currently has no `@portable-doc/code` package. An npm scope owner
must bootstrap it before the workflow can publish. For this first alpha, the
owner can stage the exact reviewed tarball without repacking it:

```sh
npm stage publish /path/to/portable-doc-code-0.1.0-alpha.1.tgz --access public --tag alpha
```

Staging reserves `0.1.0-alpha.1`, so the protected workflow cannot publish that
version while the entry is pending. Use the staging entry only to establish
the package and configure its GitHub Actions trusted publisher. Verify both the
package placeholder and trusted-publisher settings, then find the entry with
`npm stage list @portable-doc/code` and have an owner remove it with 2FA:

```sh
npm stage reject <stage-id>
```

Never approve this bootstrap entry: approval would publish the alpha outside
the protected OIDC workflow. After rejection, verify that the stage list is
empty and that the package placeholder and trusted-publisher settings still
exist. If either disappeared, stop and verify the npm state instead of
dispatching. Only then dispatch this workflow from `main` with `publish: true`
and the exact reviewed SHA-256. The protected environment remains the approval
point for the actual alpha publish.

npm expires a new trusted-publisher configuration if it does not complete a
successful validation within two days. Creating the environment, setting its
variable, configuring npm, staging, rejecting, and publishing are deliberately
outside this release-preparation change; this bootstrap sequence is not run by
repository automation.

References:

- <https://docs.npmjs.com/staged-publishing/>
- <https://docs.npmjs.com/trusted-publishers/>
