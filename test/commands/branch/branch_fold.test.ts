import { expect } from 'chai';
import { allScenes } from '../../lib/scenes/all_scenes';
import { configureTest } from '../../lib/utils/configure_test';
import { expectBranches } from '../../lib/utils/expect_branches';
import { expectCommits } from '../../lib/utils/expect_commits';

for (const scene of allScenes) {
  describe(`(${scene}): fold`, function () {
    configureTest(this, scene);

    it("Can't fold from trunk or into trunk", () => {
      scene.repo.createChange('a', 'a');
      scene.repo.runCliCommand([`branch`, `create`, `a`, `-m`, `a`]);

      expect(() => scene.repo.runCliCommand([`branch`, `fold`])).to.throw();
      expect(() =>
        scene.repo.runCliCommand([`branch`, `fold`, `--keep`])
      ).to.throw();

      scene.repo.runCliCommand([`branch`, `down`]);

      expect(() => scene.repo.runCliCommand([`branch`, `fold`])).to.throw();
      expect(() =>
        scene.repo.runCliCommand([`branch`, `fold`, `--keep`])
      ).to.throw();
    });

    it('Can fold without --keep and restack children accordingly', () => {
      scene.repo.createChange('a', 'a');
      scene.repo.runCliCommand([`branch`, `create`, `a`, `-m`, `a`]);
      scene.repo.createChange('b', 'b');
      scene.repo.runCliCommand([`branch`, `create`, `b`, `-m`, `b`]);
      scene.repo.createChange('c', 'c');
      scene.repo.runCliCommand([`branch`, `create`, `c`, `-m`, `c`]);
      scene.repo.runCliCommand([`branch`, `down`, `2`]);
      scene.repo.createChange('d', 'd');
      scene.repo.runCliCommand([`branch`, `create`, `d`, `-m`, `d`]);
      scene.repo.checkoutBranch('b');

      scene.repo.runCliCommand([`branch`, `fold`]);
      expectBranches(scene.repo, 'a, c, d, main');
      expectCommits(scene.repo, 'b, a, 1');

      scene.repo.runCliCommand([`branch`, `down`]);
      expectCommits(scene.repo, '1');

      scene.repo.checkoutBranch('c');
      expectCommits(scene.repo, 'c, b, a, 1');

      scene.repo.checkoutBranch('d');
      expectCommits(scene.repo, 'd, b, a, 1');
    });

    it('Can fold with --keep and restack children accordingly', () => {
      scene.repo.createChange('a', 'a');
      scene.repo.runCliCommand([`branch`, `create`, `a`, `-m`, `a`]);
      scene.repo.createChange('b', 'b');
      scene.repo.runCliCommand([`branch`, `create`, `b`, `-m`, `b`]);
      scene.repo.createChange('c', 'c');
      scene.repo.runCliCommand([`branch`, `create`, `c`, `-m`, `c`]);
      scene.repo.runCliCommand([`branch`, `down`, `2`]);
      scene.repo.createChange('d', 'd');
      scene.repo.runCliCommand([`branch`, `create`, `d`, `-m`, `d`]);
      scene.repo.checkoutBranch('b');

      scene.repo.runCliCommand([`branch`, `fold`, `--keep`]);
      expectBranches(scene.repo, 'b, c, d, main');
      expectCommits(scene.repo, 'b, a, 1');

      scene.repo.runCliCommand([`branch`, `down`]);
      expectCommits(scene.repo, '1');

      scene.repo.checkoutBranch('c');
      expectCommits(scene.repo, 'c, b, a, 1');

      scene.repo.checkoutBranch('d');
      expectCommits(scene.repo, 'd, b, a, 1');
    });
  });
}
